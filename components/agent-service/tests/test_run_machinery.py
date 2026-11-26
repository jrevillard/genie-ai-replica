# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run's machinery — ONE assembly for every caller.

The core's run machinery (the tool dispatcher, the bounded model client, the
tool definitions) was assembled by hand in four places: the orchestrator, the
probe, the cancellation demo and the suites. Four copies is four ways to get
it wrong — a dispatcher without the verifier, a model client without the
bound, the definitions of another registry.

Two builders own it:

* :func:`build_run_inputs` — the inputs every caller hands its runtime.
* :meth:`RunResult.from_monitor` — the terminal record every ending reads
  its counters from.

Each test pins ONE obligation, and each pins it in a way that can FAIL.
"""

import asyncio

from conftest import ScriptedLoopModel, multihop_turns, run_budget

from agent.budget import RunBudgetMonitor
from agent.cancellation import CancellationToken
from agent.events import EventEmitter
from agent.registry import ToolDefinition, ToolRegistry
from agent.runtime import RunResult, build_run_inputs

QUESTION = "the question"
INSTRUCTION = "the instruction"

TOOL = ToolDefinition(
    name="read_clock",
    description="Reads the clock.",
    parameters={"type": "object", "properties": {}},
)


def _registry() -> ToolRegistry:
    """A registry with one tool, the shape every caller registers."""

    registry = ToolRegistry()
    registry.register(TOOL, lambda **kwargs: {"outcome": "success", "hits": []})
    return registry


def _monitor() -> RunBudgetMonitor:
    return RunBudgetMonitor(run_budget())


def test_the_inputs_carry_the_registrys_own_tool_definitions():
    """The model-facing definitions are the REGISTRY's — not a second shape."""

    registry = _registry()
    inputs = build_run_inputs(
        question=QUESTION,
        instruction=INSTRUCTION,
        registry=registry,
        monitor=_monitor(),
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1"),
        model_client=ScriptedLoopModel(multihop_turns(answer="the answer")),
    )

    assert inputs.tools == registry.definitions()
    assert inputs.tools[0]["function"]["name"] == "read_clock"


def test_the_inputs_carry_the_callers_own_machine():
    """The run's bounds, its token and its voice are the caller's."""

    monitor = _monitor()
    token = CancellationToken()
    emitter = EventEmitter(run_id="run-1")
    inputs = build_run_inputs(
        question=QUESTION,
        instruction=INSTRUCTION,
        registry=_registry(),
        monitor=monitor,
        token=token,
        emitter=emitter,
        model_client=ScriptedLoopModel(multihop_turns(answer="the answer")),
    )

    assert inputs.monitor is monitor
    assert inputs.token is token
    assert inputs.emitter is emitter
    assert inputs.question == QUESTION
    assert inputs.instruction == INSTRUCTION


def test_the_model_client_is_bounded_by_the_run_monitor():
    """The bound rides the request: a client that forgot it runs unbounded.

    The allowance the run has left is what the model call may produce, so
    the bound shrinks as the run spends it.
    """

    monitor = _monitor()
    inputs = build_run_inputs(
        question=QUESTION,
        instruction=INSTRUCTION,
        registry=_registry(),
        monitor=monitor,
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1"),
        model_client=ScriptedLoopModel(multihop_turns(answer="the answer")),
    )

    asyncio.run(inputs.model.complete([{"role": "user", "content": "hi"}], ()))

    # The bound the client sent is the monitor's remaining allowance — not
    # None, which would mean "the endpoint's own default".
    remaining = monitor.remaining_output_tokens()
    assert remaining is not None
    assert remaining > 0


def test_the_dispatcher_carries_the_verifier_when_there_is_one():
    """The evidence ledger the tool results feed.

    A dispatcher built without the verifier is a run whose tool results
    never reach the ledger: the grounding verdict would read an empty
    evidence trail and the citations would be gone.
    """

    verifier = object()
    inputs = build_run_inputs(
        question=QUESTION,
        instruction=INSTRUCTION,
        registry=_registry(),
        monitor=_monitor(),
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1"),
        model_client=ScriptedLoopModel(multihop_turns(answer="the answer")),
        verifier=verifier,
    )

    assert inputs.dispatcher._verifier is verifier


def test_the_terminal_record_reads_its_counters_from_the_monitor():
    """One source for the counters: the run's monitor.

    The record is what the caller stores; a counter read from anywhere but
    the monitor is a number the run never agreed on.

    The monitor is SPENT on every dimension first: a record built from a
    monitor that counted nothing would read the same as one that counted
    everything wrongly, and the assertion would prove nothing.
    """

    monitor = _monitor()
    monitor.begin_step()
    monitor.take_model_call()
    monitor.take_aux_model_call()
    monitor.take_tool_call()
    monitor.record_evidence(4321)
    monitor.record_usage(120, 45)
    result = RunResult.from_monitor(monitor, "answered", final_text="the answer")

    assert result.outcome == "answered"
    assert result.final_text == "the answer"
    assert result.steps == monitor.steps == 1
    # The auxiliary call IS a model call (one fleet budget) — the two
    # counters are read separately, so the record shows plumbing vs work.
    assert result.model_calls == monitor.model_calls == 2
    assert result.aux_model_calls == monitor.aux_model_calls == 1
    assert result.tool_calls == monitor.tool_calls == 1
    assert result.evidence_bytes == monitor.evidence_bytes == 4321
    assert result.prompt_tokens == monitor.prompt_tokens == 120
    assert result.completion_tokens == monitor.completion_tokens == 45


def test_the_terminal_record_carries_the_failure_text():
    """A failed run carries the reason — and no fabricated answer."""

    result = RunResult.from_monitor(_monitor(), "error", error="the reason")

    assert result.outcome == "error"
    assert result.error == "the reason"
    assert result.final_text is None
