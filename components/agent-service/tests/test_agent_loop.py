# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The provisional custom minimal loop behind the seam (story 2.1, AD-5).

Mutation-sensitive pins: the multi-hop probe shape completes search →
read_source → answer with the exact event sequence on the seam vocabulary
(every event envelope-carried, none a BFF frame name), the loop feeds tool
results back as role-``tool`` messages, an unregistered dispatch ends the
run honestly, budget exhaustion ends it honestly with NO fabricated
answer, a cancellation stops dispatching and reaches the in-flight call
with no terminal event, and the port's declared errors flow back as data —
never as fabricated results.
"""

import asyncio
import json

import pytest
from conftest import AgentFakePort, ScriptedLoopModel

from agent.budget import RunBudget, RunBudgetMonitor
from agent.cancellation import CancellationToken
from agent.events import BFF_FRAME_NAMES, AgentEvent, EventEmitter
from agent.loop import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_ERROR,
    AgentLoop,
    ModelTurn,
    ToolCallRequest,
)
from agent.probe import PROBE_OPERATION_BUDGET, document_toolset
from capabilities.contract import (
    AuthorizationError,
    CallerContext,
    LegacyFileProvenance,
    OperationName,
    OutcomeCode,
    QueryPreparationStatus,
    ReadSourceResult,
    SearchHit,
    SearchKnowledgeResult,
)

PROBE_CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
DEFAULT_BUDGET = RunBudget(max_steps=6, max_model_calls=6, max_tool_calls=6, wall_clock_seconds=30.0)


def _search_result(hits=None, outcome=OutcomeCode.SUCCESS):
    if hits is None:
        hits = (
            SearchHit(provenance=LegacyFileProvenance(file_id="f-1"), text="The grievance process text.", score=0.9),
        )
    return SearchKnowledgeResult(
        outcome=outcome, hits=hits, query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH
    )


def _read_result(content="The grievance process is defined in this document."):
    return ReadSourceResult(
        outcome=OutcomeCode.SUCCESS,
        provenance=LegacyFileProvenance(file_id="f-1"),
        content=content,
    )


def _turn(content=None, tool_calls=(), finish_reason="stop", prompt_tokens=None, completion_tokens=None):
    return ModelTurn(
        content=content,
        tool_calls=tool_calls,
        finish_reason=finish_reason,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


def _tool_call(call_id, name, arguments):
    return ToolCallRequest(call_id=call_id, name=name, arguments=arguments)


MULTI_HOP_TURNS = (
    _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "complaint handling process"}),)),
    _turn(tool_calls=(_tool_call("call-2", "read_source", {"target": {"file_id": "f-1"}}),)),
    _turn(content="The grievance process is X; it is defined in document f-1."),
)


def _port(**kwargs) -> AgentFakePort:
    return AgentFakePort(search_result=_search_result(), read_result=_read_result(), **kwargs)


def _loop(model, port=None, budget=None, token=None, registry=None):
    collector: list[AgentEvent] = []
    token = token if token is not None else CancellationToken()
    if registry is None:
        registry = document_toolset(port if port is not None else _port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    monitor = RunBudgetMonitor(budget or DEFAULT_BUDGET)
    loop = AgentLoop(
        model=model,
        registry=registry,
        monitor=monitor,
        token=token,
        emitter=EventEmitter(run_id="run-1", sink=collector.append),
        system_prompt="probe system prompt",
    )
    return loop, collector, monitor


# ---------------------------------------------------------------------
# The multi-hop happy path: search → read_source → answer
# ---------------------------------------------------------------------


def test_multihop_run_completes_through_search_read_and_answer():
    model = ScriptedLoopModel(MULTI_HOP_TURNS)
    port = _port()
    loop, collector, monitor = _loop(model, port=port)
    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.outcome == OUTCOME_ANSWERED
    assert result.final_text == "The grievance process is X; it is defined in document f-1."
    assert result.steps == 3
    assert result.model_calls == 3
    assert result.tool_calls == 2
    assert [call["request"].query.text for call in port.search_calls] == ["complaint handling process"]
    assert [call["request"].target.file_id for call in port.read_calls] == ["f-1"]
    assert monitor.steps == 3 and monitor.model_calls == 3 and monitor.tool_calls == 2


def test_multihop_event_sequence_rides_the_seam_vocabulary():
    loop, collector, _ = _loop(ScriptedLoopModel(MULTI_HOP_TURNS))
    asyncio.run(loop.run("How are complaints handled?"))

    assert [event.kind.value for event in collector] == [
        "run_started",
        "tool_call_started",  # search_knowledge
        "tool_call_finished",
        "tool_call_started",  # read_source
        "tool_call_finished",
        "text_message_started",
        "text_message_content",
        "text_message_finished",
        "run_finished",
    ]
    assert [event.seq for event in collector] == list(range(9))
    for event in collector:
        assert set(event.model_dump()) == {"run_id", "call_id", "seq", "kind", "payload"}
        assert event.run_id == "run-1"
        assert event.kind.value not in BFF_FRAME_NAMES
    assert collector[-1].payload == {"outcome": OUTCOME_ANSWERED}
    assert collector[1].call_id == "call-1" and collector[2].call_id == "call-1"
    assert collector[3].call_id == "call-2" and collector[4].call_id == "call-2"
    assert collector[6].payload == {"text": "The grievance process is X; it is defined in document f-1."}


def test_the_loop_feeds_tool_results_back_as_role_tool_messages():
    model = ScriptedLoopModel(MULTI_HOP_TURNS)
    loop, _, _ = _loop(model)
    asyncio.run(loop.run("How are complaints handled?"))

    first_request, second_request = model.requests[0], model.requests[1]
    assert [message["role"] for message in first_request["messages"]] == ["system", "user"]
    assert first_request["messages"][1]["content"] == "How are complaints handled?"
    assistant = second_request["messages"][2]
    assert assistant["role"] == "assistant"
    assert assistant["tool_calls"] == [
        {
            "id": "call-1",
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "arguments": json.dumps({"query": "complaint handling process"}),
            },
        }
    ]
    tool_result = second_request["messages"][3]
    assert tool_result["role"] == "tool"
    assert tool_result["tool_call_id"] == "call-1"
    assert json.loads(tool_result["content"]) == {"result": _search_result().model_dump(mode="json")}


def test_the_registry_definitions_reach_the_model_call_verbatim():
    model = ScriptedLoopModel(MULTI_HOP_TURNS)
    loop, _, _ = _loop(model)
    asyncio.run(loop.run("q"))
    expected = loop.registry.definitions()
    assert [definition["function"]["name"] for definition in expected] == ["search_knowledge", "read_source"]
    assert model.requests[0]["tool_definitions"] == expected


# ---------------------------------------------------------------------
# The unregistered name: refused before any resolution
# ---------------------------------------------------------------------


def test_an_unregistered_tool_call_ends_the_run_honestly():
    port = _port()
    model = ScriptedLoopModel((_turn(tool_calls=(_tool_call("c-x", "delete_everything", {}),)),))
    loop, collector, _ = _loop(model, port=port)
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_ERROR
    assert result.final_text is None
    assert "delete_everything" in result.error
    assert [event.kind.value for event in collector] == ["run_started", "tool_call_started", "run_error"]
    assert collector[-1].payload["code"] == OUTCOME_ERROR
    assert port.search_calls == []  # the refusal preceded any resolution


# ---------------------------------------------------------------------
# Budget exhaustion: the run ends honestly, no fabricated answer
# ---------------------------------------------------------------------


def test_model_call_budget_exhaustion_ends_the_run_at_the_next_check():
    model = ScriptedLoopModel(MULTI_HOP_TURNS)  # needs a second model call the budget refuses
    loop, collector, monitor = _loop(
        model, budget=RunBudget(max_steps=6, max_model_calls=1, max_tool_calls=6, wall_clock_seconds=30.0)
    )
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert result.final_text is None
    assert monitor.model_calls == 1
    assert collector[-1].kind.value == "run_error"
    assert collector[-1].payload["code"] == OUTCOME_BUDGET_EXHAUSTED
    assert "model-call budget" in collector[-1].payload["message"]


def test_tool_call_budget_exhaustion_refuses_the_second_dispatch():
    two_calls = _turn(
        tool_calls=(
            _tool_call("call-1", "search_knowledge", {"query": "q"}),
            _tool_call("call-2", "read_source", {"target": {"file_id": "f-1"}}),
        )
    )
    loop, collector, monitor = _loop(
        ScriptedLoopModel((two_calls, _turn(content="unused"))),
        budget=RunBudget(max_steps=6, max_model_calls=6, max_tool_calls=1, wall_clock_seconds=30.0),
    )
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert result.final_text is None
    assert monitor.tool_calls == 1  # the refused dispatch never counted
    assert [event.kind.value for event in collector] == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "tool_call_started",  # the second call is announced, then refused
        "run_error",
    ]


def test_step_budget_exhaustion_stops_the_loop():
    loop, collector, monitor = _loop(
        ScriptedLoopModel(MULTI_HOP_TURNS),
        budget=RunBudget(max_steps=1, max_model_calls=6, max_tool_calls=6, wall_clock_seconds=30.0),
    )
    result = asyncio.run(loop.run("q"))
    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert monitor.steps == 1
    assert collector[-1].payload["code"] == OUTCOME_BUDGET_EXHAUSTED


def test_wall_clock_budget_stops_the_loop():
    real_sleep = asyncio.sleep

    class SlowModel:
        async def complete(self, messages, tool_definitions):
            await real_sleep(0.05)  # the wall clock runs out during the model call
            return _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),))

    loop, collector, monitor = _loop(
        SlowModel(),
        budget=RunBudget(max_steps=6, max_model_calls=6, max_tool_calls=6, wall_clock_seconds=0.01),
    )
    result = asyncio.run(loop.run("q"))
    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert monitor.steps == 1
    assert collector[-1].payload["code"] == OUTCOME_BUDGET_EXHAUSTED


# ---------------------------------------------------------------------
# Cancellation: dispatching stops, the in-flight call is cancelled
# ---------------------------------------------------------------------


def test_a_pre_cancelled_run_never_dispatches():
    recorder: dict = {}
    token = CancellationToken()
    token.cancel()

    class RecordingModel:
        async def complete(self, messages, tool_definitions):
            recorder["called"] = True
            return _turn(content="unused")

    loop, collector, _ = _loop(RecordingModel(), token=token)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(loop.run("q"))
    assert recorder == {}
    assert [event.kind.value for event in collector] == ["run_started"]  # no terminal event


def test_a_cancellation_during_the_in_flight_model_call_propagates_untouched():
    recorder: dict = {}
    token = CancellationToken()

    class HangingModel:
        async def complete(self, messages, tool_definitions):
            recorder["started"] = True
            try:
                await asyncio.Event().wait()  # forever
            except asyncio.CancelledError:
                recorder["cancelled_in_flight"] = True
                raise

    async def run_all():
        async def fire_when_running():
            while "started" not in recorder:
                await asyncio.sleep(0)
            token.cancel()

        asyncio.get_running_loop().create_task(fire_when_running())
        loop, collector, monitor = _loop(HangingModel(), token=token)
        with pytest.raises(asyncio.CancelledError):
            await loop.run("q")
        return collector, monitor

    collector, monitor = asyncio.run(run_all())
    assert recorder["cancelled_in_flight"] is True
    assert [event.kind.value for event in collector] == ["run_started"]  # no terminal event
    assert monitor.model_calls == 1  # the in-flight call was counted before it was cancelled


def test_a_cancellation_during_the_in_flight_tool_call_propagates_untouched():
    recorder: dict = {}
    token = CancellationToken()

    async def hanging_executor(arguments):
        recorder["started"] = True
        try:
            await asyncio.Event().wait()  # forever
        except asyncio.CancelledError:
            recorder["cancelled_in_flight"] = True
            raise

    from agent.registry import ToolDefinition, ToolRegistry

    registry = ToolRegistry()
    registry.register(ToolDefinition(name="slow_tool", description="", parameters={"type": "object"}), hanging_executor)

    async def run_all():
        async def fire_when_running():
            while "started" not in recorder:
                await asyncio.sleep(0)
            token.cancel()

        asyncio.get_running_loop().create_task(fire_when_running())
        model = ScriptedLoopModel((_turn(tool_calls=(_tool_call("c-1", "slow_tool", {}),)),))
        loop, collector, monitor = _loop(model, token=token, registry=registry)
        with pytest.raises(asyncio.CancelledError):
            await loop.run("q")
        return collector

    collector = asyncio.run(run_all())
    assert recorder["cancelled_in_flight"] is True
    assert [event.kind.value for event in collector] == ["run_started", "tool_call_started"]


# ---------------------------------------------------------------------
# The port's declared error surface flows back as data
# ---------------------------------------------------------------------


def test_a_port_authorization_failure_flows_back_as_a_structured_tool_result():
    port = AgentFakePort(
        search_result=AuthorizationError(
            "the legacy corpus is not in the authorized set", operation=OperationName.SEARCH_KNOWLEDGE
        )
    )
    model = ScriptedLoopModel(
        (
            _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),)),
            _turn(content="I could not find an answer in the corpus."),
        )
    )
    loop, collector, _ = _loop(model, port=port)
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_ANSWERED
    tool_content = json.loads(model.requests[1]["messages"][3]["content"])
    assert tool_content == {
        "error": {
            "code": "authorization_failure",
            "operation": "search_knowledge",
            "message": "the legacy corpus is not in the authorized set",
        }
    }
    assert collector[2].payload == tool_content  # the finished event reports what the model was fed


def test_invalid_model_arguments_flow_back_as_a_structured_tool_result():
    model = ScriptedLoopModel(
        (
            _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"wrong": "shape"}),)),
            _turn(content="I could not use that tool call."),
        )
    )
    loop, collector, _ = _loop(model)
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_ANSWERED
    tool_content = json.loads(model.requests[1]["messages"][3]["content"])
    assert tool_content["error"]["code"] == "invalid_arguments"


def test_an_insufficient_search_flows_as_data_and_the_run_finishes_honestly():
    # Insufficiency is an answer type, not an error (the contract): it
    # flows to the model as the tool result, and an honest abstention is a
    # finished run — the evidence outcome is the model's final turn.
    port = AgentFakePort(search_result=_search_result(hits=(), outcome=OutcomeCode.INSUFFICIENT_EVIDENCE))
    model = ScriptedLoopModel(
        (
            _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),)),
            _turn(content="The corpus does not contain the answer to this question."),
        )
    )
    loop, collector, _ = _loop(model, port=port)
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_ANSWERED
    tool_content = json.loads(model.requests[1]["messages"][3]["content"])
    assert tool_content["result"]["outcome"] == "insufficient_evidence"
    assert tool_content["result"]["hits"] == []
    assert collector[-1].kind.value == "run_finished"


def test_an_empty_final_turn_fails_honestly_instead_of_answering():
    loop, collector, _ = _loop(ScriptedLoopModel((_turn(),)))
    result = asyncio.run(loop.run("q"))
    assert result.outcome == OUTCOME_ERROR
    assert result.final_text is None
    assert "neither a tool call nor a final text" in result.error
    assert collector[-1].kind.value == "run_error"


# ---------------------------------------------------------------------
# Usage accounting
# ---------------------------------------------------------------------


def test_token_usage_is_summed_as_served():
    turns = (
        _turn(
            tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),),
            prompt_tokens=10,
            completion_tokens=5,
        ),
        _turn(content="done", prompt_tokens=20, completion_tokens=7),
    )
    loop, _, _ = _loop(ScriptedLoopModel(turns))
    result = asyncio.run(loop.run("q"))
    assert (result.prompt_tokens, result.completion_tokens) == (30, 12)


def test_usage_stays_none_when_the_endpoint_discards_it():
    loop, _, _ = _loop(ScriptedLoopModel((_turn(content="done"),)))
    result = asyncio.run(loop.run("q"))
    assert result.prompt_tokens is None and result.completion_tokens is None
