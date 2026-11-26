# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The runtime port — the seam's driver contract.

One runtime drives a run. The port says what a runtime may do, and what it
must not:

* A runtime CALLS THE MODEL (through the core's bounded client), DISPATCHES
  TOOLS (through the core's dispatcher), and returns the drafted text with
  its result.
* A runtime NEVER emits a lifecycle event, NEVER decides the delivered text,
  NEVER verifies, and NEVER knows a BFF frame name. Those belong to the
  core — which is why a second runtime inherits them instead of
  re-implementing them.

The inputs are what one run needs: the question, the system prompt
(``instruction``), the model-facing definitions of the registered tools
(``tools``), the model client, the tool dispatcher, the budget monitor, the
cancellation token and the event emitter. Everything the run needs travels
in the inputs, so a runtime instance holds no per-run state: one instance
serves many runs, and nothing of a run leaks into the next.

``model`` is a client whose output bound is ALREADY capped. The bound used
to ride as an optional ``max_output_tokens`` argument that each call site
passed by hand, and a runtime that forgets it runs unbounded — so the core
wraps the client once (:class:`BoundedModelClient`) and hands the wrapper
to the runtime. The bound is structural instead of a convention every call
site must honour.
"""

from dataclasses import dataclass
from typing import Protocol

from capabilities.model import LoopModelClient, ModelTurn

from .budget import RunBudgetMonitor
from .cancellation import CancellationToken
from .dispatcher import ToolDispatcher
from .events import EventEmitter

# The outcome vocabulary of a run's evidence. ``cancelled`` is never
# RETURNED by a runtime — the CancelledError propagates untouched and the
# caller (the orchestrator) records it — it is defined here so the
# vocabulary has one home.
OUTCOME_ANSWERED = "answered"
OUTCOME_ERROR = "error"
OUTCOME_BUDGET_EXHAUSTED = "budget_exhausted"
OUTCOME_CANCELLED = "cancelled"


@dataclass(frozen=True)
class RunResult:
    """The terminal record of a completed run (never produced for a cancellation).

    Every counter comes from the run's budget monitor — a runtime owns no
    usage state of its own, so the record and the cancellation's partial
    evidence read the same source. ``final_text`` is the model's final
    turn only — an exhausted or failed run carries ``None``, never a
    fabricated answer.
    """

    outcome: str
    final_text: str | None
    steps: int
    model_calls: int
    aux_model_calls: int
    tool_calls: int
    evidence_bytes: int
    wall_clock_seconds: float
    prompt_tokens: int | None
    completion_tokens: int | None
    error: str | None = None


class BoundedModelClient:
    """The model client with its output bound capped by the core.

    The cap rides the request as ``max_output_tokens``: the allowance the
    run's monitor has left, which shrinks as the run spends it. The
    runtime never passes it — it cannot forget it — and the client it wraps
    still receives the same bound it received before the wrapper existed.
    """

    def __init__(self, client: LoopModelClient, monitor: RunBudgetMonitor) -> None:
        self._client = client
        self._monitor = monitor

    async def complete(self, messages: list[dict], tool_definitions: tuple[dict, ...]) -> ModelTurn:
        """One completion, bounded by the run's remaining allowance."""

        return await self._client.complete(
            messages,
            tool_definitions,
            max_output_tokens=self._monitor.remaining_output_tokens(),
        )


@dataclass(frozen=True)
class RunInputs:
    """What one run hands to its runtime.

    ``tools`` is the model-facing definitions in the OpenAI function-tool
    shape — the registry's own definitions, not a second shape. ``model``
    is the core's bounded client, ``dispatcher`` the core's tool dispatch:
    the runtime reaches the corpus through the dispatcher and through
    nothing else.
    """

    question: str
    instruction: str
    tools: tuple[dict, ...]
    model: BoundedModelClient
    dispatcher: ToolDispatcher
    monitor: RunBudgetMonitor
    token: CancellationToken
    emitter: EventEmitter


class RuntimeDriver(Protocol):
    """The seam's driver contract.

    ``runtime_id`` names the implementation — it rides the execution
    version record, so a run is attributable to the runtime that served it.
    """

    runtime_id: str

    async def run(self, inputs: RunInputs) -> RunResult: ...
