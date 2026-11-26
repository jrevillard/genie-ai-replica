# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The provisional runtime candidate: the custom minimal loop behind the seam.

One implementation of "whatever drives the loop": model call → tool dispatch
through the core's dispatcher → the drafted text. It is a PROBE candidate,
not a production commitment: if the runtime decision selects another
runtime, that runtime plugs onto the same seam — this envelope, this
vocabulary, this registry, these budget and cancellation hooks — and this
module carries no successor obligation; whichever runtime is selected builds
the production integration slice on this seam.

The loop implements the runtime port (:mod:`agent.runtime`): it drives the
model, dispatches the tools through the core's dispatcher, and returns the
drafted text with its result. It emits NO event — the handshake, the
delivered text, the verdict and the terminal belong to the core
(:mod:`agent.governance`) — and it holds no per-run state: the message list
is a local of :meth:`run`, so one instance serves many runs and nothing of
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
  An exhausted budget ends the run honestly: the core's terminal event, the
  ``budget_exhausted`` outcome, no fabricated answer text.
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

import tracing
from capabilities.model import ModelTurn

from .cancellation import run_cancellable
from .runtime import OUTCOME_ANSWERED, OUTCOME_ERROR, RunInputs, RunResult


class AgentLoop:
    """The minimal governed loop: model call → dispatcher → the drafted text.

    The run's monitor, token, emitter, model client and dispatcher arrive
    with the run's inputs (:class:`agent.runtime.RunInputs`); the registry
    travels with the dispatcher. The instance keeps nothing between runs.
    """

    runtime_id = "custom-minimal-loop"
    """The runtime's identity — it rides the execution-version record, so a
    run is attributable to the runtime that drove it. ONE string: the
    probe's evidence carries the same one (it reads it from here), and a
    record join across the two evidence streams must not miss."""

    async def run(self, inputs: RunInputs) -> RunResult:
        """Drive one run to its terminal outcome; cancellation propagates."""
        messages = [
            {"role": "system", "content": inputs.instruction},
            {"role": "user", "content": inputs.question},
        ]
        while True:
            # The budget checks precede the span: a refused dispatch
            # (step, token or fleet model-call budget spent) opens no
            # span — the model_call span covers DISPATCHED calls only.
            inputs.monitor.begin_step()
            inputs.token.raise_if_cancelled()
            inputs.monitor.check_tokens()
            inputs.monitor.take_model_call()
            with tracing.with_span("agent.model_call", attributes={"step": inputs.monitor.steps}) as model_span:
                # The token bound rides the request, capped by the core's
                # bounded client — the runtime never passes it, so it cannot
                # forget it.
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
            return self._answered(turn, inputs)

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

    def _answered(self, turn: ModelTurn, inputs: RunInputs) -> RunResult:
        """The final (text) turn: the drafted answer and the run's result.

        The delivered text is the CORE's: the mechanical insufficiency
        decision may replace the drafted text with the standard explicit
        message, and the verdict rides after the text events — so the
        runtime hands over the draft and keeps no say in what is delivered.
        """
        text = turn.content if isinstance(turn.content, str) and turn.content.strip() else None
        if text is None:
            # Neither a tool call nor a final text is a protocol anomaly;
            # the run ends honestly instead of answering with nothing.
            return self._failed(OUTCOME_ERROR, "the model returned neither a tool call nor a final text", inputs)
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
        return RunResult.from_monitor(inputs.monitor, outcome, final_text=final_text, error=error)

    def _failed(self, outcome: str, message: str, inputs: RunInputs) -> RunResult:
        """The runtime's own protocol failure — reported, never dressed up as
        an answer. The terminal event is the core's."""
        return self._terminal(outcome, inputs, error=message)
