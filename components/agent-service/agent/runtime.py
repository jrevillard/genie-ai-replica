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
from typing import Protocol, runtime_checkable

from capabilities.model import LoopModelClient, ModelTurn

from .budget import RunBudgetMonitor
from .cancellation import CancellationToken
from .dispatcher import ToolDispatcher
from .events import EventEmitter
from .registry import ToolRegistry
from .verification import VerificationPipeline

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
    evidence read the same source. ``final_text`` is the DELIVERED text:
    the model's final turn, or the standard insufficiency message when
    the ledger's state requires it. A runtime's own result carries its
    DRAFT — the delivery is the core's decision — and the core rewrites
    the field before the run's record leaves. An exhausted or failed run
    carries ``None``, never a fabricated answer.
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

    @classmethod
    def from_monitor(
        cls,
        monitor: RunBudgetMonitor,
        outcome: str,
        *,
        final_text: str | None = None,
        error: str | None = None,
    ) -> "RunResult":
        """The record built from the run's budget monitor.

        One builder for every terminal: the loop's own ending and the
        core's failure path read the SAME counters from the SAME source,
        so the two can never drift into reporting different usage for one
        run.
        """

        return cls(
            outcome=outcome,
            final_text=final_text,
            steps=monitor.steps,
            model_calls=monitor.model_calls,
            aux_model_calls=monitor.aux_model_calls,
            tool_calls=monitor.tool_calls,
            evidence_bytes=monitor.evidence_bytes,
            wall_clock_seconds=monitor.elapsed_seconds,
            prompt_tokens=monitor.prompt_tokens,
            completion_tokens=monitor.completion_tokens,
            error=error,
        )


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


def build_run_inputs(
    *,
    question: str,
    instruction: str,
    registry: ToolRegistry,
    monitor: RunBudgetMonitor,
    token: CancellationToken,
    emitter: EventEmitter,
    model_client: LoopModelClient,
    verifier: VerificationPipeline | None = None,
) -> RunInputs:
    """The run's inputs, assembled from the parts every caller holds.

    One wiring for the whole seam: the tool dispatcher, the bounded model
    client and the tool definitions are the core's, and a caller that
    assembled them by hand had four ways to get the run's machinery wrong
    (a dispatcher without the verifier, a client without the bound, the
    definitions of another registry). The callers that differ — the
    question, the instruction, the run's own emitter and monitor — stay
    theirs.
    """

    return RunInputs(
        question=question,
        instruction=instruction,
        tools=registry.definitions(),
        model=BoundedModelClient(model_client, monitor),
        dispatcher=ToolDispatcher(registry=registry, monitor=monitor, token=token, emitter=emitter, verifier=verifier),
        monitor=monitor,
        token=token,
        emitter=emitter,
    )


@runtime_checkable
class RuntimeDriver(Protocol):
    """The seam's driver contract.

    ``runtime_id`` names the implementation — it rides the execution
    version record, so a run is attributable to the runtime that served it.

    Runtime-checkable, so the core can ASK whether a runtime satisfies the
    port before it drives it (a runtime that does not is refused with the
    honest terminal, not an ``AttributeError`` from the middle of a run).
    """

    runtime_id: str

    async def run(self, inputs: RunInputs) -> RunResult: ...
