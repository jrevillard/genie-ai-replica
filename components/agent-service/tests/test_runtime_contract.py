# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The runtime port's contract suite.

Five rules every ``RuntimeDriver`` must satisfy. The suite is
PARAMETERIZED over the implementations — the custom minimal loop and a
scripted second runtime — and every rule carries ONE violator: a runtime
that breaks exactly that rule. Each violator has its own test, and that
test asserts the rule CATCHES it — a rule nobody can fail is not a rule.

| # | Rule |
|---|---|
| C1 | An unregistered tool is invisible to the model and refused at dispatch |
| C2 | Each budget dimension bounds the run; auxiliary calls count |
| C3 | ``cancel()`` stops the run, with no terminal event and readable counters |
| C4 | Only tool event kinds leave the runtime; each ``started`` has its ``finished`` |
| C5 | One runtime instance over two runs: nothing of the first leaks into the second |

The rules are checked the way each rule demands: C1, C2, C4 and C5 drive
the runtime DIRECTLY (what the runtime itself does — what it shows the
model, what it calls, what it emits, what it keeps), while C3 drives the
core's governed run (a cancellation is a property of the RUN, and the
terminal event is the core's).
"""

import asyncio
import json

import pytest
from conftest import HangingLoopModel, cancel_when_started

from agent.budget import BudgetExhausted, RunBudget, RunBudgetMonitor
from agent.cancellation import CancellationToken, run_cancellable
from agent.dispatcher import ToolDispatcher
from agent.events import EventEmitter, EventKind
from agent.governance import governed_run
from agent.loop import AgentLoop
from agent.registry import ToolDefinition, ToolRegistry, UnregisteredToolError
from agent.runtime import OUTCOME_ANSWERED, OUTCOME_BUDGET_EXHAUSTED, BoundedModelClient, RunInputs, RunResult
from capabilities.model import ModelTurn, ToolCallRequest

QUESTION = "the question"
INSTRUCTION = "the instruction"

# A budget generous enough for every rule's scenario; each rule lowers ONE
# dimension to the bound it tests.
GENEROUS = {
    "max_steps": 8,
    "max_model_calls": 8,
    "max_tool_calls": 8,
    "max_total_tokens": 100000,
    "max_evidence_bytes": 1000000,
    "wall_clock_seconds": 30.0,
}


# ---------------------------------------------------------------------
# The doubles: one registered tool, one model, one set of machinery
# ---------------------------------------------------------------------


class _EchoExecutor:
    """The one registered tool's executor — it records what it was asked,
    so a suite can prove the corpus was never reached."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def __call__(self, arguments: dict) -> dict:
        self.calls.append(dict(arguments))
        return {"echo": arguments.get("text", "")}


def _registry(executor: _EchoExecutor) -> ToolRegistry:
    """The registry with exactly one registered tool."""

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="echo",
            description="echo the text back",
            parameters={"type": "object", "properties": {"text": {"type": "string"}}},
        ),
        executor,
    )
    return registry


def _turn(**kwargs) -> ModelTurn:
    """One model turn; the served usage is reported (the token budget needs
    a number to bite on)."""

    return ModelTurn(prompt_tokens=100, completion_tokens=10, **kwargs)


class _Model:
    """The model double: canned turns in order, every request recorded."""

    def __init__(self, turns) -> None:
        self._turns = list(turns)
        self.requests: list[dict] = []

    async def complete(self, messages, tool_definitions, *, max_output_tokens):
        self.requests.append(
            {
                "messages": [dict(message) for message in messages],
                "tool_definitions": tool_definitions,
                "max_output_tokens": max_output_tokens,
            }
        )
        if not self._turns:
            raise AssertionError("the scripted model ran out of turns")
        return self._turns.pop(0)


def _budget(**overrides) -> RunBudget:
    return RunBudget(**{**GENEROUS, **overrides})


def _inputs(*, model, registry, monitor, token, emitter, question=QUESTION) -> RunInputs:
    """The run's inputs over the given machinery."""

    return RunInputs(
        question=question,
        instruction=INSTRUCTION,
        tools=registry.definitions(),
        model=BoundedModelClient(model, monitor),
        dispatcher=ToolDispatcher(registry=registry, monitor=monitor, token=token, emitter=emitter),
        monitor=monitor,
        token=token,
        emitter=emitter,
    )


def _result(inputs: RunInputs, outcome: str, final_text: str | None = None, error: str | None = None) -> RunResult:
    """The terminal record, counted from the run's monitor."""

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


# ---------------------------------------------------------------------
# The compliant runtimes
# ---------------------------------------------------------------------


class _ScriptedRuntime:
    """A second compliant runtime: it drives the model and dispatches the
    tool the model asked for, through the core's dispatcher.

    It is a SECOND implementation of the same contract, so it claims the
    run's budget the way the loop does: the dimensions bound the run
    whoever drives it, and a runtime that forgot to claim them would run
    past their bounds.
    """

    runtime_id = "scripted"

    async def run(self, inputs: RunInputs) -> RunResult:
        messages = [
            {"role": "system", "content": inputs.instruction},
            {"role": "user", "content": inputs.question},
        ]
        while True:
            inputs.monitor.begin_step()
            inputs.token.raise_if_cancelled()
            inputs.monitor.check_tokens()
            inputs.monitor.take_model_call()
            turn = await run_cancellable(inputs.token, inputs.model.complete(list(messages), inputs.tools))
            inputs.monitor.record_usage(turn.prompt_tokens, turn.completion_tokens)
            if not turn.tool_calls:
                return _result(inputs, OUTCOME_ANSWERED, turn.content)
            for request in turn.tool_calls:
                payload = await inputs.dispatcher.dispatch(request)
                result_json = json.dumps(payload)
                inputs.monitor.record_evidence(len(result_json.encode("utf-8")))
                messages.append({"role": "tool", "tool_call_id": request.call_id, "content": result_json})


RUNTIMES = {"custom-loop": AgentLoop, "scripted": _ScriptedRuntime}


def _runtime(runtime_id: str):
    """One instance of the named runtime."""

    factory = RUNTIMES[runtime_id]
    return factory()


# ---------------------------------------------------------------------
# The violators: one per rule, each breaking exactly that rule
# ---------------------------------------------------------------------


class _LeakyRuntime:
    """C1's violator: it shows the model a tool the registry does not carry."""

    runtime_id = "leaky"

    async def run(self, inputs: RunInputs) -> RunResult:
        ghost = {"type": "function", "function": {"name": "ghost", "description": "", "parameters": {}}}
        turn = await inputs.model.complete([], inputs.tools + (ghost,))
        return _result(inputs, OUTCOME_ANSWERED, turn.content)


class _UnboundedRuntime:
    """C2's violator: it calls the model without claiming the budget."""

    runtime_id = "unbounded"

    async def run(self, inputs: RunInputs) -> RunResult:
        turn = await inputs.model.complete([], inputs.tools)
        while turn.tool_calls:
            for request in turn.tool_calls:
                await inputs.dispatcher.dispatch(request)
            turn = await inputs.model.complete([], inputs.tools)
        return _result(inputs, OUTCOME_ANSWERED, turn.content)


class _SwallowingRuntime:
    """C3's violator: it swallows the cancellation and answers anyway."""

    runtime_id = "swallowing"

    async def run(self, inputs: RunInputs) -> RunResult:
        try:
            turn = await run_cancellable(inputs.token, inputs.model.complete([], inputs.tools))
        except asyncio.CancelledError:
            return _result(inputs, OUTCOME_ANSWERED, "the answer nobody cancelled")
        return _result(inputs, OUTCOME_ANSWERED, turn.content)


class _ChattyRuntime:
    """C4's violator: it emits a lifecycle event of its own."""

    runtime_id = "chatty"

    async def run(self, inputs: RunInputs) -> RunResult:
        inputs.emitter.emit(EventKind.RUN_FINISHED, {"outcome": OUTCOME_ANSWERED})
        turn = await inputs.model.complete([], inputs.tools)
        return _result(inputs, OUTCOME_ANSWERED, turn.content)


class _LeakyStateRuntime:
    """C5's violator: it keeps the message list on the instance, so the
    second run sees the first run's turns."""

    runtime_id = "leaky-state"

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def run(self, inputs: RunInputs) -> RunResult:
        self.messages.append({"role": "user", "content": inputs.question})
        turn = await inputs.model.complete(self.messages, inputs.tools)
        return _result(inputs, OUTCOME_ANSWERED, turn.content)


# ---------------------------------------------------------------------
# C1 — an unregistered tool is invisible to the model and refused
# ---------------------------------------------------------------------


def _c1_holds(runtime) -> bool:
    """The model only ever sees the registered tools, and a dispatch of an
    unregistered name is refused before the tool is reached."""

    executor = _EchoExecutor()
    registry = _registry(executor)
    model = _Model([_turn(tool_calls=(ToolCallRequest(call_id="call-1", name="not_registered", arguments={}),))])
    monitor = RunBudgetMonitor(_budget())
    token = CancellationToken()
    emitter = EventEmitter(run_id="run-1")
    refused = False
    try:
        asyncio.run(runtime.run(_inputs(model=model, registry=registry, monitor=monitor, token=token, emitter=emitter)))
    except UnregisteredToolError:
        refused = True
    definitions = model.requests[0]["tool_definitions"] if model.requests else ()
    shown = [definition["function"]["name"] for definition in definitions]
    return shown == ["echo"] and executor.calls == [] and refused


@pytest.mark.parametrize("runtime_id", sorted(RUNTIMES))
def test_c1_an_unregistered_tool_is_invisible_to_the_model_and_refused_at_dispatch(runtime_id):
    assert _c1_holds(_runtime(runtime_id))


def test_the_c1_violator_is_caught():
    """A runtime that shows the model a tool the registry does not carry
    breaks C1."""

    assert not _c1_holds(_LeakyRuntime())


# ---------------------------------------------------------------------
# C2 — each budget dimension bounds the run, and the calls are counted
# ---------------------------------------------------------------------


def _c2_holds(runtime) -> bool:
    """Every budget dimension stops the run, no answer is fabricated, and
    every model call the runtime made is counted."""

    for dimension in ("max_steps", "max_model_calls", "max_tool_calls", "max_total_tokens", "max_evidence_bytes"):
        if not _c2_bounds(runtime, dimension):
            return False
    return True


def _c2_bounds(runtime, dimension: str) -> bool:
    """One dimension, one scenario: the model asks for two tools, so every
    dimension has a second chance to bite."""

    executor = _EchoExecutor()
    registry = _registry(executor)
    model = _Model(
        [
            _turn(tool_calls=(ToolCallRequest(call_id="call-1", name="echo", arguments={"text": "one"}),)),
            _turn(tool_calls=(ToolCallRequest(call_id="call-2", name="echo", arguments={"text": "two"}),)),
            _turn(content="the answer"),
        ]
    )
    monitor = RunBudgetMonitor(_budget(**{dimension: 1}))
    token = CancellationToken()
    emitter = EventEmitter(run_id="run-1")
    try:
        result = asyncio.run(
            runtime.run(_inputs(model=model, registry=registry, monitor=monitor, token=token, emitter=emitter))
        )
        outcome = result.outcome
        final_text = result.final_text
    except BudgetExhausted:
        outcome = OUTCOME_BUDGET_EXHAUSTED
        final_text = None
    except Exception:  # noqa: BLE001 — any other failure is not a bounded run
        outcome = "failed"
        final_text = None
    if outcome != OUTCOME_BUDGET_EXHAUSTED or final_text is not None:
        return False
    # Every model call the runtime made is counted — no call hides from the
    # record.
    if monitor.model_calls + monitor.aux_model_calls != len(model.requests):
        return False
    # The dimension's own consumption never went past its bound: the check
    # precedes the spend, so the run stopped AT the bound. The cumulative
    # dimensions (tokens, evidence) are counted by what they refused to
    # spend: the model call and the dispatch that never happened.
    return {
        "max_steps": monitor.steps,
        "max_model_calls": monitor.model_calls,
        "max_tool_calls": monitor.tool_calls,
        "max_total_tokens": len(model.requests),
        "max_evidence_bytes": monitor.tool_calls,
    }[dimension] <= 1


@pytest.mark.parametrize("runtime_id", sorted(RUNTIMES))
def test_c2_each_budget_dimension_bounds_the_run_and_the_calls_are_counted(runtime_id):
    assert _c2_holds(_runtime(runtime_id))


def test_the_c2_violator_is_caught():
    """A runtime that calls the model without claiming the budget runs
    past its bound — C2 catches it."""

    assert not _c2_holds(_UnboundedRuntime())


# ---------------------------------------------------------------------
# C3 — a cancellation stops the run, with no terminal event
# ---------------------------------------------------------------------


def _c3_holds(runtime) -> bool:
    """The cancellation reaches the in-flight call, the run ends without a
    terminal event, and the counters stay readable."""

    recorder: dict = {}
    model = HangingLoopModel(recorder)
    executor = _EchoExecutor()
    registry = _registry(executor)
    monitor = RunBudgetMonitor(_budget())
    token = CancellationToken()
    collected: list = []
    emitter = EventEmitter(run_id="run-1", sink=collected.append)
    inputs = _inputs(model=model, registry=registry, monitor=monitor, token=token, emitter=emitter)

    async def scenario() -> bool:
        task = asyncio.ensure_future(governed_run(runtime, inputs))
        asyncio.ensure_future(cancel_when_started(recorder, token))
        try:
            await task
        except asyncio.CancelledError:
            return True
        return False

    propagated = asyncio.run(scenario())
    terminal = [
        event.kind.value
        for event in collected
        if event.kind in (EventKind.RUN_FINISHED, EventKind.RUN_ERROR, EventKind.VERDICT)
    ]
    return propagated and not terminal and monitor.steps >= 1 and recorder.get("cancelled_in_flight") is True


@pytest.mark.parametrize("runtime_id", sorted(RUNTIMES))
def test_c3_a_cancellation_stops_the_run_with_no_terminal_event(runtime_id):
    assert _c3_holds(_runtime(runtime_id))


def test_the_c3_violator_is_caught():
    """A runtime that swallows the cancellation answers anyway — C3 catches
    it."""

    assert not _c3_holds(_SwallowingRuntime())


# ---------------------------------------------------------------------
# C4 — only tool event kinds leave the runtime, and they pair up
# ---------------------------------------------------------------------


def _c4_holds(runtime) -> bool:
    """Every event the runtime leaves is a tool event, and each started has
    its finished under the same call id."""

    executor = _EchoExecutor()
    registry = _registry(executor)
    model = _Model(
        [
            _turn(tool_calls=(ToolCallRequest(call_id="call-1", name="echo", arguments={"text": "one"}),)),
            _turn(content="the answer"),
        ]
    )
    monitor = RunBudgetMonitor(_budget())
    token = CancellationToken()
    collected: list = []
    emitter = EventEmitter(run_id="run-1", sink=collected.append)
    asyncio.run(runtime.run(_inputs(model=model, registry=registry, monitor=monitor, token=token, emitter=emitter)))
    kinds = [event.kind.value for event in collected]
    started = [event.call_id for event in collected if event.kind is EventKind.TOOL_CALL_STARTED]
    finished = [event.call_id for event in collected if event.kind is EventKind.TOOL_CALL_FINISHED]
    return all(kind.startswith("tool_call") for kind in kinds) and sorted(started) == sorted(finished)


@pytest.mark.parametrize("runtime_id", sorted(RUNTIMES))
def test_c4_only_tool_event_kinds_leave_the_runtime_and_they_pair_up(runtime_id):
    assert _c4_holds(_runtime(runtime_id))


def test_the_c4_violator_is_caught():
    """A runtime that emits a lifecycle event of its own breaks C4."""

    assert not _c4_holds(_ChattyRuntime())


# ---------------------------------------------------------------------
# C5 — one runtime instance over two runs, no leak
# ---------------------------------------------------------------------


def _c5_holds(runtime) -> bool:
    """The second run sees nothing of the first: its messages carry only its
    own question, and its counters start fresh."""

    executor = _EchoExecutor()
    registry = _registry(executor)
    model = _Model([_turn(content="the answer"), _turn(content="the answer")])
    results = []
    for question in ("the first question", "the second question"):
        monitor = RunBudgetMonitor(_budget())
        token = CancellationToken()
        emitter = EventEmitter(run_id="run-1")
        result = asyncio.run(
            runtime.run(
                _inputs(
                    model=model,
                    registry=registry,
                    monitor=monitor,
                    token=token,
                    emitter=emitter,
                    question=question,
                )
            )
        )
        results.append(result)
    second_request = model.requests[1]
    messages = [message["content"] for message in second_request["messages"]]
    return "the second question" in messages and "the first question" not in messages and results[1].steps == 1


@pytest.mark.parametrize("runtime_id", sorted(RUNTIMES))
def test_c5_one_runtime_instance_over_two_runs_leaks_nothing(runtime_id):
    assert _c5_holds(_runtime(runtime_id))


def test_the_c5_violator_is_caught():
    """A runtime that keeps its message list on the instance carries the
    first run into the second — C5 catches it."""

    assert not _c5_holds(_LeakyStateRuntime())
