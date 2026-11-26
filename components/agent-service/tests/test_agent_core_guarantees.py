# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The CORE's guarantees at the seam — what the core owns, whatever the runtime does.

The core drives the runtime, and the core owns the terminal: the outcome
vocabulary, the delivered text, the failure policy, the ending. A runtime
that breaks its side of the port still gets an honest ending:

* an outcome the core does not accept never reaches the wire as a code
  (the vocabulary is closed and core-owned);
* a cancelled run ends WITHOUT a terminal event (there is no honest
  terminal state to fabricate for a stopped run);
* an answered run with no text fails honestly instead of emitting a null
  chunk (no consumer accepts one);
* a delivery-phase failure (a verdict that raises, a sink that refuses)
  still ends the run — the result carries the outcome;
* a wiring defect (a factory that raises, a runtime that does not satisfy
  the port) reaches the caller as the honest terminal, never as an
  exception past a stream that already started.
"""

import asyncio

import pytest
from conftest import (
    AgentFakePort,
    ScriptedLoopModel,
    _governed_loop,
    multihop_turns,
)

from agent.events import EventEmitter
from agent.runtime import OUTCOME_ANSWERED, OUTCOME_BUDGET_EXHAUSTED, OUTCOME_CANCELLED, OUTCOME_ERROR, RunResult


def _result(outcome: str, final_text: str | None = None, error: str | None = None, steps: int = 1) -> RunResult:
    """One run result, with the counters the runtime would have filled."""

    return RunResult(
        outcome=outcome,
        final_text=final_text,
        steps=steps,
        model_calls=0,
        aux_model_calls=0,
        tool_calls=0,
        evidence_bytes=0,
        wall_clock_seconds=0.0,
        prompt_tokens=None,
        completion_tokens=None,
        error=error,
    )


class _ScriptedRuntime:
    """A runtime that returns what the suite hands it, and nothing else."""

    runtime_id = "scripted-guarantees"

    def __init__(self, result=None, raises: Exception | None = None) -> None:
        self._result = result
        self._raises = raises

    async def run(self, inputs):
        if self._raises is not None:
            raise self._raises
        return self._result


def _governed(runtime, model=None, port=None):
    """The governed run over a runtime of the suite's own choosing."""

    model = model if model is not None else ScriptedLoopModel(multihop_turns(answer="the answer"))
    port = port if port is not None else AgentFakePort()
    return _governed_loop(model, port, runtime=runtime)


def _kinds(collector):
    return [event.kind.value for event in collector]


def _terminal(collector):
    return next(event for event in collector if event.kind.value in ("run_error", "run_finished"))


def test_a_runtime_outcome_the_core_does_not_accept_never_reaches_the_wire_as_a_code():
    """The vocabulary is closed and CORE-owned (ADR-005).

    A runtime that invents an outcome of its own gets the core's error
    code; its string may ride the MESSAGE, never the code — the BFF
    persists the code as the run's outcome, and a foreign value there
    would be a run whose outcome the client cannot read.
    """

    runtime = _ScriptedRuntime(_result("partially_answered", final_text="draft"))
    runner, collector, _monitor, _verifier = _governed(runtime)

    result = asyncio.run(runner.run("a question"))

    assert _terminal(collector).payload["code"] == OUTCOME_ERROR
    assert result.outcome == OUTCOME_ERROR
    # The runtime's own string is kept in the message, where a human reads it.
    assert "partially_answered" in _terminal(collector).payload["message"]


def test_a_cancelled_runtime_ends_the_run_without_a_terminal_event():
    """A cancelled run has NO terminal event.

    The wire contract says so: a cancelled run's outcome is "stopped", and
    there is no honest terminal state to fabricate for it — the BFF's own
    teardown finalizes the turn. A runtime that reports the cancellation
    therefore PROPAGATES the cancellation instead of being turned into a
    failure terminal.
    """

    runtime = _ScriptedRuntime(_result(OUTCOME_CANCELLED, steps=0))
    runner, collector, _monitor, _verifier = _governed(runtime)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(runner.run("a question"))

    assert "run_error" not in _kinds(collector)
    assert "run_finished" not in _kinds(collector)


def test_an_answered_run_without_text_fails_honestly_instead_of_emitting_a_null_chunk():
    """A null chunk is not a frame any consumer accepts.

    The runtime claims an answer and hands over no text: the core does not
    emit ``{"text": null}`` — the run ends with the honest terminal, and
    the delivered text is nothing at all.
    """

    runtime = _ScriptedRuntime(_result(OUTCOME_ANSWERED))
    runner, collector, _monitor, _verifier = _governed(runtime)

    result = asyncio.run(runner.run("a question"))

    assert "text_message_content" not in _kinds(collector)
    assert _terminal(collector).payload["code"] == OUTCOME_ERROR
    assert result.outcome == OUTCOME_ERROR
    assert result.final_text is None


def test_a_delivery_failure_still_ends_the_run_with_its_outcome():
    """A failure in the delivery phase is the core's to end.

    The verdict's finalize is inside the core's own delivery: a failure
    there used to escape the governed run, so the probe died with a
    traceback and the runtime decision lost its evidence record. The run
    now ends with the failure terminal and the result carries the outcome.
    """

    class _Boom(Exception):
        pass

    class _ExplodingVerifier:
        """A verifier whose finalize raises — the delivery phase's defect."""

        def insufficiency_decision(self):
            return {"required": False}

        async def finalize(self, text):
            raise _Boom("the verdict could not be built")

    runtime = _ScriptedRuntime(_result(OUTCOME_ANSWERED, final_text="the answer"))
    runner, collector, _monitor, _verifier = _governed(runtime)
    runner.verifier = _ExplodingVerifier()

    result = asyncio.run(runner.run("a question"))

    assert _terminal(collector).payload["code"] == OUTCOME_ERROR
    assert result.outcome == OUTCOME_ERROR
    assert "_Boom" in result.error


def test_a_sink_that_refuses_the_terminal_does_not_turn_the_ending_into_an_exception():
    """The terminal is the run's last word — even to a broken sink.

    A sink that raises while the terminal is written cannot be delivered
    to (there is nowhere left to deliver it), but the RESULT must still
    come back: the caller — the probe — records it, and the run does not
    die with a traceback.
    """

    class _BrokenSink:
        def __init__(self) -> None:
            self.calls = 0

        def __call__(self, event) -> None:
            self.calls += 1
            raise _BrokenSinkError("the sink is closed")

    class _BrokenSinkError(Exception):
        pass

    runtime = _ScriptedRuntime(_result(OUTCOME_ANSWERED, final_text="the answer"))
    model = ScriptedLoopModel(multihop_turns(answer="the answer"))
    runner, collector, _monitor, _verifier = _governed(runtime, model=model)
    # The sink that refuses every write — the handshake, the text, the
    # terminal: there is nowhere left to deliver anything to.
    runner.emitter = EventEmitter(run_id="run-1", sink=_BrokenSink())

    result = asyncio.run(runner.run("a question"))

    assert result.outcome == OUTCOME_ERROR
    assert "_BrokenSinkError" in result.error


def test_the_budget_exhausted_outcome_is_the_core_own_code():
    """The one runtime outcome the core accepts as its own."""

    runtime = _ScriptedRuntime(_result(OUTCOME_BUDGET_EXHAUSTED, steps=8, error="the budget is spent"))
    runner, collector, _monitor, _verifier = _governed(runtime)

    result = asyncio.run(runner.run("a question"))

    assert _terminal(collector).payload["code"] == OUTCOME_BUDGET_EXHAUSTED
    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
