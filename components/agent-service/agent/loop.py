# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The provisional runtime candidate: the custom minimal loop behind the seam.

One implementation of "whatever drives the loop": model call → tool dispatch
through the registry → events on the seam vocabulary. It is a PROBE
candidate, not a production commitment: if the runtime decision selects
another runtime, that runtime plugs onto the same seam — this envelope, this
vocabulary, this registry, these budget and cancellation hooks — and this
module carries no successor obligation; whichever runtime is selected builds
the production integration slice on this seam.

What the loop owns, and the invariants it keeps:

* **The port is reached only through the registry.** The loop never touches
  the document capability port directly; the tool executors registered in
  the registry adapt model-generated arguments into the contract's input
  types. Nothing unregistered is dispatched (the registry refuses before
  any resolution), so nothing unreachable through the registry is called.
* **Budget checks precede every dispatch** — the step before the iteration,
  the model call (and the served-usage token check) before the model, the
  tool call (and the wall clock and the evidence volume) before each tool.
  An exhausted budget ends the run honestly:
  ``run_error`` terminal event, ``budget_exhausted`` outcome, no fabricated
  answer text.
* **Cancellation stops dispatching and reaches the in-flight call.** The
  token is checked before every dispatch and every in-flight model/tool
  call is raced against it; ``CancelledError`` propagates untouched and NO
  terminal event is emitted — a cancelled run has no honest terminal state
  to fabricate.
* **The port's declared error surface flows back as data.** A
  ``CapabilityError`` from an executor (authorization refusal, transient
  failure) and a model-argument validation error are structured tool
  results the model can react to — retrieved/error content is data, never
  an instruction channel. The loop never invents a result for them.

The message list is the loop's own state, in the OpenAI-compatible shape
its model clients speak (the conventions ``noagent.generation`` records):
system + user, assistant tool-call turns, role-``tool`` results.
"""

import json
import logging
from dataclasses import dataclass
from typing import Protocol

from pydantic import ValidationError

from capabilities.contract import CapabilityError

from .budget import BudgetExhausted, RunBudgetMonitor
from .cancellation import CancellationToken, run_cancellable
from .events import EventEmitter, EventKind
from .registry import ToolRegistry, UnregisteredToolError

logger = logging.getLogger(__name__)

# The outcome vocabulary of a run's evidence. ``cancelled`` is never
# RETURNED by the loop — the CancelledError propagates untouched and the
# caller (the probe harness) records it — it is defined here so the
# vocabulary has one home.
OUTCOME_ANSWERED = "answered"
OUTCOME_ERROR = "error"
OUTCOME_BUDGET_EXHAUSTED = "budget_exhausted"
OUTCOME_CANCELLED = "cancelled"

_MESSAGE_TRUNCATION = 200


@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model asked for: its wire id, name, arguments."""

    call_id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelTurn:
    """One model call's outcome, in the loop's own shape.

    ``content`` is the final text when the turn answers; ``tool_calls``
    carries the requested dispatches when the turn works. Usage is the
    token accounting as the endpoint served it (``None`` when the endpoint
    discarded it) — the evidence record reports usage as served, never a
    local estimate.
    """

    content: str | None = None
    tool_calls: tuple[ToolCallRequest, ...] = ()
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LoopModelClient(Protocol):
    """The model-call seam the loop drives — one non-streaming completion.

    The concrete OpenAI-compatible client is the runtime's business (the
    probe carries one, shared with the run surface); the loop depends on
    this shape only, which is what keeps the loop runtime-swappable.
    ``max_output_tokens`` is the remaining token allowance the monitor
    hands the call — the token bound riding the request (``None`` when the
    allowance is unknowable and the field must be omitted, the deployed
    only-when-configured rule).
    """

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn: ...


@dataclass(frozen=True)
class RunResult:
    """The terminal record of a completed run (never produced for a cancellation).

    Every counter comes from the run's budget monitor — the loop owns no
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


@dataclass
class AgentLoop:
    """The minimal governed loop: model call → registry dispatch → seam events.

    Constructed per run with the run's monitor, token and emitter (the
    request orchestrator / probe harness builds them, so a cancelled run
    still leaves readable counters behind); the registry is the run's
    authorization surface. One instance drives ONE run — the message list
    is per-run state created in :meth:`run`, the usage counters live on
    the monitor.
    """

    model: LoopModelClient
    registry: ToolRegistry
    monitor: RunBudgetMonitor
    token: CancellationToken
    emitter: EventEmitter
    system_prompt: str

    async def run(self, question: str) -> RunResult:
        """Drive one run to a terminal outcome; cancellation propagates."""
        self._messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": question},
        ]
        tool_definitions = self.registry.definitions()
        self.emitter.emit(EventKind.RUN_STARTED, {"question": question})
        try:
            while True:
                self.monitor.begin_step()
                self.token.raise_if_cancelled()
                self.monitor.check_tokens()
                self.monitor.take_model_call()
                # The token bound rides the request: the call may spend at
                # most the remaining allowance (None — field omitted — when
                # the served usage is a lower bound and no honest bound
                # exists).
                turn = await run_cancellable(
                    self.token,
                    self.model.complete(
                        list(self._messages),
                        tool_definitions,
                        max_output_tokens=self.monitor.remaining_output_tokens(),
                    ),
                )
                self.monitor.record_usage(turn.prompt_tokens, turn.completion_tokens)
                if turn.tool_calls:
                    self._messages.append(self._assistant_tool_call_message(turn))
                    for request in turn.tool_calls:
                        result_payload = await self._dispatch_tool(request)
                        self._messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": request.call_id,
                                "content": json.dumps(result_payload),
                            }
                        )
                    continue
                return self._finish(turn)
        except UnregisteredToolError as refused:
            # The registry refused before any resolution; the run ends
            # honestly with the refusal — no tool result is invented.
            return self._fail(OUTCOME_ERROR, str(refused))
        except BudgetExhausted as exhausted:
            return self._fail(OUTCOME_BUDGET_EXHAUSTED, str(exhausted))
        except Exception as failed:  # noqa: BLE001 — a failed run still gets its terminal event
            logger.warning("agent run failed: %s: %s", type(failed).__name__, str(failed)[:_MESSAGE_TRUNCATION])
            return self._fail(OUTCOME_ERROR, f"{type(failed).__name__}: {str(failed)[:_MESSAGE_TRUNCATION]}")

    # -- the model turn ------------------------------------------------------

    def _finish(self, turn: ModelTurn) -> RunResult:
        """A final (text) turn: the text-message lifecycle, then the terminal event."""
        text = turn.content if isinstance(turn.content, str) and turn.content.strip() else None
        if text is None:
            # Neither a tool call nor a final text is a protocol anomaly;
            # the run ends honestly instead of answering with nothing.
            return self._fail(OUTCOME_ERROR, "the model returned neither a tool call nor a final text")
        self.emitter.emit(EventKind.TEXT_MESSAGE_STARTED, {"role": "assistant"})
        self.emitter.emit(EventKind.TEXT_MESSAGE_CONTENT, {"text": text})
        self.emitter.emit(EventKind.TEXT_MESSAGE_FINISHED, {})
        self.emitter.emit(EventKind.RUN_FINISHED, {"outcome": OUTCOME_ANSWERED})
        return self._terminal(OUTCOME_ANSWERED, final_text=text)

    def _assistant_tool_call_message(self, turn: ModelTurn) -> dict:
        """The assistant message that carries the requested tool calls back on the list."""
        return {
            "role": "assistant",
            "content": turn.content,
            "tool_calls": [
                {
                    "id": request.call_id,
                    "type": "function",
                    "function": {"name": request.name, "arguments": json.dumps(request.arguments)},
                }
                for request in turn.tool_calls
            ],
        }

    # -- tool dispatch ---------------------------------------------------------

    async def _dispatch_tool(self, request: ToolCallRequest) -> dict:
        """One tool call: budget and token checks, lifecycle events, registry dispatch.

        The checks precede the ``tool_call_started`` event, so a refused
        dispatch (budget spent, run cancelled) never announces a tool call
        that will not run — every started event is answered by a finish, a
        refusal, or a cancellation that reached a genuinely in-flight call.
        The registry refuses an unregistered name (that refusal propagates —
        it ends the run); a port error or an invalid argument flows back to
        the model as the structured tool result. Both paths emit the
        ``tool_call_finished`` event that reports what actually happened.
        The executed result's size is the evidence the run accumulates.
        """
        self.monitor.check_wall_clock()
        self.token.raise_if_cancelled()
        self.monitor.check_evidence_volume()
        self.monitor.take_tool_call()
        self.emitter.emit(
            EventKind.TOOL_CALL_STARTED,
            {"name": request.name, "arguments": request.arguments},
            call_id=request.call_id,
        )
        result_payload = await self._execute(request)
        self.monitor.record_evidence(len(json.dumps(result_payload).encode("utf-8")))
        self.emitter.emit(EventKind.TOOL_CALL_FINISHED, result_payload, call_id=request.call_id)
        return result_payload

    async def _execute(self, request: ToolCallRequest) -> dict:
        """Run the executor through the registry; map the declared error surface to data."""
        try:
            result = await run_cancellable(self.token, self.registry.dispatch(request.name, request.arguments))
        except (CapabilityError, ValidationError) as failed:
            # The contract's declared errors (and the argument validation a
            # model can violate) are data for the model, not run failures:
            # the loop never fabricates a successful result for them, and
            # never converts one into an instruction.
            if isinstance(failed, CapabilityError):
                code, operation = failed.code.value, failed.operation.value if failed.operation else None
            else:
                code, operation = "invalid_arguments", None
            detail = {"code": code, "operation": operation, "message": str(failed)[:_MESSAGE_TRUNCATION]}
            logger.info(
                "tool %s reported %s: %s",
                request.name,
                detail["code"],
                detail["message"],
            )
            return {"error": detail}
        return {"result": result}

    # -- failure and usage -------------------------------------------------

    def _terminal(self, outcome: str, *, final_text: str | None = None, error: str | None = None) -> RunResult:
        """The terminal record every completed run returns: the run's monitor
        counts, the accumulated usage, and the outcome the caller asked for."""
        return RunResult(
            outcome=outcome,
            final_text=final_text,
            steps=self.monitor.steps,
            model_calls=self.monitor.model_calls,
            aux_model_calls=self.monitor.aux_model_calls,
            tool_calls=self.monitor.tool_calls,
            evidence_bytes=self.monitor.evidence_bytes,
            wall_clock_seconds=self.monitor.elapsed_seconds,
            prompt_tokens=self.monitor.prompt_tokens,
            completion_tokens=self.monitor.completion_tokens,
            error=error,
        )

    def _fail(self, outcome: str, message: str) -> RunResult:
        """End the run honestly: the terminal ``run_error``, no answer text."""
        self.emitter.emit(EventKind.RUN_ERROR, {"code": outcome, "message": message[:_MESSAGE_TRUNCATION]})
        return self._terminal(outcome, error=message[:_MESSAGE_TRUNCATION])
