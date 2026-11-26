# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The provisional runtime candidate: the custom minimal loop behind the seam.

One implementation of "whatever drives the loop": model call → tool dispatch
through the core's dispatcher → events on the seam vocabulary. It is a PROBE
candidate, not a production commitment: if the runtime decision selects
another runtime, that runtime plugs onto the same seam — this envelope, this
vocabulary, this registry, these budget and cancellation hooks — and this
module carries no successor obligation; whichever runtime is selected builds
the production integration slice on this seam.

The loop implements the runtime port (:mod:`agent.runtime`): it takes the
run's inputs, drives the model and the tool dispatch, and returns the
drafted text with its result. It holds no per-run state — the message list
is a local of :meth:`run` — so one instance serves many runs and nothing of
one run leaks into the next.

What the loop owns, and the invariants it keeps:

* **The corpus is reached only through the dispatcher.** The loop never
  touches the document capability port directly; the tool executors
  registered in the registry adapt model-generated arguments into the
  contract's input types, and the dispatcher is the only path to them.
  Nothing unregistered is dispatched (the registry refuses before any
  resolution), so nothing unreachable through the registry is called.
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

import tracing
from capabilities.model import ModelTurn

from .budget import BudgetExhausted
from .cancellation import run_cancellable
from .events import MESSAGE_TRUNCATION, EventKind, run_started_payload
from .registry import UnregisteredToolError
from .runtime import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_ERROR,
    RunInputs,
    RunResult,
)
from .verification import INSUFFICIENCY_RESPONSE, VerificationPipeline

logger = logging.getLogger(__name__)


class AgentLoop:
    """The minimal governed loop: model call → dispatcher → seam events.

    The run's monitor, token, emitter, model client and dispatcher arrive
    with the run's inputs; the verifier and the execution-version record
    are the loop's own construction material (the verdict and the
    run-start handshake are the loop's business until the governance moves
    to the core). The registry is the run's authorization surface, and it
    travels with the dispatcher.

    The message list is per-run state created in :meth:`run` — the instance
    keeps nothing between runs.
    """

    runtime_id = "custom-loop"

    def __init__(self, verifier: VerificationPipeline | None = None, execution_versions: dict | None = None) -> None:
        self._verifier = verifier
        # The run's execution-version record, built by the request
        # orchestrator at assembly. ``None`` keeps the probe-shaped
        # ``{"question"}`` payload — the handshake key is additive.
        self._execution_versions = execution_versions

    async def run(self, inputs: RunInputs) -> RunResult:
        """Drive one run to a terminal outcome; cancellation propagates."""
        messages = [
            {"role": "system", "content": inputs.instruction},
            {"role": "user", "content": inputs.question},
        ]
        inputs.emitter.emit(EventKind.RUN_STARTED, run_started_payload(inputs.question, self._execution_versions))
        # The run-path span uses the ACTIVATING helper deliberately: the
        # per-model-call and per-tool-call children below (and the
        # verification/judge spans) are opened with ``tracing.with_span``,
        # which parents them to the ACTIVE span — the activation is what
        # makes ``agent.run`` their parent, and what the outbound model /
        # doc-repo hops inherit for traceparent propagation. Attributes are
        # counters/ids only (the record and the events carry the facts).
        with tracing.background_span("agent.run"):
            try:
                while True:
                    # The budget checks precede the span: a refused dispatch
                    # (step, token or fleet model-call budget spent) opens no
                    # span — the model_call span covers DISPATCHED calls only.
                    inputs.monitor.begin_step()
                    inputs.token.raise_if_cancelled()
                    inputs.monitor.check_tokens()
                    inputs.monitor.take_model_call()
                    with tracing.with_span("agent.model_call", attributes={"step": inputs.monitor.steps}) as model_span:
                        # The token bound rides the request, capped by the
                        # core's bounded client — the runtime never passes
                        # it, so it cannot forget it.
                        turn = await run_cancellable(
                            inputs.token,
                            inputs.model.complete(list(messages), inputs.tools),
                        )
                        self._model_span_counters(model_span, turn)
                    inputs.monitor.record_usage(turn.prompt_tokens, turn.completion_tokens)
                    if turn.tool_calls:
                        messages.append(self._assistant_tool_call_message(turn))
                        for request in turn.tool_calls:
                            result_payload = await inputs.dispatcher.dispatch(request)
                            # One serialization home: the evidence size and the
                            # tool message report the same bytes.
                            result_json = json.dumps(result_payload)
                            inputs.monitor.record_evidence(len(result_json.encode("utf-8")))
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": request.call_id,
                                    "content": result_json,
                                }
                            )
                        continue
                    return await self._finish(turn, inputs)
            except UnregisteredToolError as refused:
                # The registry refused before any resolution; the run ends
                # honestly with the refusal — no tool result is invented.
                return self._fail(OUTCOME_ERROR, str(refused), inputs)
            except BudgetExhausted as exhausted:
                return self._fail(OUTCOME_BUDGET_EXHAUSTED, str(exhausted), inputs)
            except Exception as failed:  # noqa: BLE001 — a failed run still gets its terminal event
                logger.warning("agent run failed: %s: %s", type(failed).__name__, str(failed)[:MESSAGE_TRUNCATION])
                return self._fail(OUTCOME_ERROR, f"{type(failed).__name__}: {str(failed)[:MESSAGE_TRUNCATION]}", inputs)

    @staticmethod
    def _model_span_counters(span, turn: ModelTurn) -> None:
        """The model-call span's counters/ids — never message text."""
        span.set_attribute("tool_calls", len(turn.tool_calls))
        if turn.finish_reason:
            span.set_attribute("finish_reason", turn.finish_reason)
        if turn.prompt_tokens is not None:
            span.set_attribute("prompt_tokens", turn.prompt_tokens)
        if turn.completion_tokens is not None:
            span.set_attribute("completion_tokens", turn.completion_tokens)

    # -- the model turn ------------------------------------------------------

    async def _finish(self, turn: ModelTurn, inputs: RunInputs) -> RunResult:
        """A final (text) turn: the mechanical insufficiency decision, the
        text-message lifecycle, the verification verdict, the terminal.

        The finalize is SPLIT around the text events, per the spec's pinned
        window (verification between the text events and the terminal):

        * BEFORE the text events: the CHEAP mechanical insufficiency
          decision (pure ledger reads, no judge) — its verdict owns the
          delivered text, so when the ledger's state requires the
          insufficiency response (no retrieval that grew the citations, or
          a degraded one), the model's drafted text is discarded and the
          standard explicit message is what streams. Time-to-first-chunk
          never absorbs the judge latency.
        * AFTER the text events, BEFORE the verdict event: the validity
          check and the judged grounding over the EMITTED text — the
          verdict event lands after the last text event and before the
          terminal, exactly the pinned position (the BFF projects the text
          events onto chunks and the verdict onto client agent_verdict).
          The finalize is the verification pipeline's own budgeted scope —
          its failures degrade to unverified inside it, never into the
          run's terminal state.
        """
        text = turn.content if isinstance(turn.content, str) and turn.content.strip() else None
        if text is None:
            # Neither a tool call nor a final text is a protocol anomaly;
            # the run ends honestly instead of answering with nothing.
            return self._fail(OUTCOME_ERROR, "the model returned neither a tool call nor a final text", inputs)
        if self._verifier is not None and self._verifier.insufficiency_decision()["required"]:
            # Insufficiency by mechanism, not prose: the ledger decided,
            # the drafted text is discarded, the standard message is the
            # delivered answer.
            text = INSUFFICIENCY_RESPONSE
        inputs.emitter.emit(EventKind.TEXT_MESSAGE_STARTED, {"role": "assistant"})
        inputs.emitter.emit(EventKind.TEXT_MESSAGE_CONTENT, {"text": text})
        inputs.emitter.emit(EventKind.TEXT_MESSAGE_FINISHED, {})
        if self._verifier is not None:
            verdict = await self._verifier.finalize(text)
            inputs.emitter.emit(EventKind.VERDICT, verdict.payload())
        inputs.emitter.emit(EventKind.RUN_FINISHED, {"outcome": OUTCOME_ANSWERED})
        return self._terminal(OUTCOME_ANSWERED, inputs, final_text=text)

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

    # -- failure and usage -------------------------------------------------

    def _terminal(
        self, outcome: str, inputs: RunInputs, *, final_text: str | None = None, error: str | None = None
    ) -> RunResult:
        """The terminal record every completed run returns: the run's monitor
        counts, the accumulated usage, and the outcome the caller asked for."""
        monitor = inputs.monitor
        return RunResult(
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

    def _fail(self, outcome: str, message: str, inputs: RunInputs) -> RunResult:
        """End the run honestly: the terminal ``run_error``, no answer text."""
        inputs.emitter.emit(EventKind.RUN_ERROR, {"code": outcome, "message": message[:MESSAGE_TRUNCATION]})
        return self._terminal(outcome, inputs, error=message[:MESSAGE_TRUNCATION])
