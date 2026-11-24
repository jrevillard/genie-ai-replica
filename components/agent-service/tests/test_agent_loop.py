# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The provisional custom minimal loop behind the seam.

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
from conftest import (
    AgentFakePort,
    HangingLoopModel,
    ScriptedLoopModel,
    cancel_when_started,
    canned_read_result,
    canned_search_result,
    hang_until_cancelled,
    run_budget,
)

from agent.budget import RunBudgetMonitor
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
from agent.verification import VerificationPipeline
from capabilities.contract import (
    AuthorizationError,
    CallerContext,
    OperationName,
    OutcomeCode,
)

PROBE_CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))


DEFAULT_BUDGET = run_budget()


def _search_result(hits=None, outcome=OutcomeCode.SUCCESS):
    return canned_search_result(hits=hits, outcome=outcome)


def _read_result(content="The grievance process is defined in this document."):
    return canned_read_result(content)


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


def _verifying_loop(model, judge_turns=(), budget=None, token=None):
    """A loop WITH the governed verification pipeline wired (the answer
    path's shape): the verifier shares the loop's monitor (the judge is one
    aux call on the same fleet budget) and its judge replies are a separate
    ScriptedLoopModel script."""
    collector: list[AgentEvent] = []
    token = token if token is not None else CancellationToken()
    monitor = RunBudgetMonitor(budget or DEFAULT_BUDGET)
    verifier = VerificationPipeline(
        policy="verdict-marked",
        judge_timeout_ms=5000,
        judge_model_client=ScriptedLoopModel(judge_turns),
        monitor=monitor,
        authorized_repos=PROBE_CONTEXT.authorized_repos,
    )
    loop = AgentLoop(
        model=model,
        registry=document_toolset(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET),
        monitor=monitor,
        token=token,
        emitter=EventEmitter(run_id="run-1", sink=collector.append),
        system_prompt="probe system prompt",
        verifier=verifier,
    )
    return loop, collector, monitor


def _loop(model, port=None, budget=None, token=None, registry=None, verifier=None):
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
        verifier=verifier,
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
    assert result.aux_model_calls == 0  # the loop makes no aux calls of its own
    assert result.tool_calls == 2
    assert result.evidence_bytes > 0  # the executed tool results are the evidence
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


# ---------------------------------------------------------------------
# The citation verdict: pinned position, aux-only, honest degradation
# ---------------------------------------------------------------------


def test_the_verdict_lands_after_the_last_text_event_and_before_the_terminal():
    loop, collector, monitor = _verifying_loop(
        ScriptedLoopModel(MULTI_HOP_TURNS), judge_turns=(_turn(content='{"verdict": "grounded"}'),)
    )
    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.outcome == OUTCOME_ANSWERED
    kinds = [event.kind.value for event in collector]
    assert kinds[kinds.index("verdict") - 1] == "text_message_finished"
    assert kinds[kinds.index("verdict") + 1] == "run_finished"
    payload = collector[kinds.index("verdict")].payload
    assert payload["grounding_status"] == "grounded"
    assert payload["is_grounded"] is True
    assert payload["translation_mode"] == "none"
    assert payload["policy"] == "verdict-marked"
    assert payload["judge"]["outcome"] == "completed"
    # The delivered set dedups by stable identity: the search hit and the
    # read source resolve to the same file_id — one citation.
    assert len(payload["citations"]) == 1
    assert payload["marking"] == {"required": False, "reason": None}
    # The judge is an AUX call: the shared model-call budget counts it,
    # the tool-call count does not move.
    assert monitor.aux_model_calls == 1 and monitor.tool_calls == 2


def test_a_failed_run_emits_no_verdict():
    loop, collector, _ = _verifying_loop(ScriptedLoopModel(MULTI_HOP_TURNS), budget=run_budget(max_model_calls=1))
    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert "verdict" not in [event.kind.value for event in collector]


def test_a_cancelled_run_never_reaches_a_verdict():
    loop, collector, _ = _verifying_loop(ScriptedLoopModel(MULTI_HOP_TURNS))
    loop.token.cancel()

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(loop.run("How are complaints handled?"))

    assert "verdict" not in [event.kind.value for event in collector]


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
    loop, collector, monitor = _loop(model, budget=run_budget(max_model_calls=1))
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
        budget=run_budget(max_tool_calls=1),
    )
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert result.final_text is None
    assert monitor.tool_calls == 1  # the refused dispatch never counted
    # The checks precede the started event: a refused dispatch never
    # announces a tool call that will not run.
    assert [event.kind.value for event in collector] == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "run_error",
    ]


def test_step_budget_exhaustion_stops_the_loop():
    loop, collector, monitor = _loop(
        ScriptedLoopModel(MULTI_HOP_TURNS),
        budget=run_budget(max_steps=1),
    )
    result = asyncio.run(loop.run("q"))
    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert monitor.steps == 1
    assert collector[-1].payload["code"] == OUTCOME_BUDGET_EXHAUSTED


def test_wall_clock_budget_stops_the_loop():
    real_sleep = asyncio.sleep

    class SlowModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            await real_sleep(0.05)  # the wall clock runs out during the model call
            return _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),))

    loop, collector, monitor = _loop(
        SlowModel(),
        budget=run_budget(wall_clock_seconds=0.01),
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
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
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

    async def run_all():
        asyncio.get_running_loop().create_task(cancel_when_started(recorder, token))
        loop, collector, monitor = _loop(HangingLoopModel(recorder), token=token)
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

    from agent.registry import ToolDefinition, ToolRegistry

    registry = ToolRegistry()

    async def hanging_executor(arguments):
        await hang_until_cancelled(recorder)  # never returns

    registry.register(ToolDefinition(name="slow_tool", description="", parameters={"type": "object"}), hanging_executor)

    async def run_all():
        asyncio.get_running_loop().create_task(cancel_when_started(recorder, token))
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


# ---------------------------------------------------------------------
# The token bound rides the model request; the evidence accumulates
# ---------------------------------------------------------------------


def test_the_token_bound_rides_each_model_request_as_the_remaining_allowance():
    turns = (
        _turn(
            tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),),
            prompt_tokens=30,
            completion_tokens=20,
        ),
        _turn(content="done"),
    )
    model = ScriptedLoopModel(turns)
    loop, _, monitor = _loop(model, budget=run_budget(max_total_tokens=100))
    asyncio.run(loop.run("q"))

    assert model.requests[0]["max_output_tokens"] == 100  # the full allowance before anything was served
    assert model.requests[1]["max_output_tokens"] == 50  # 100 − 50 served
    # The final turn discarded its usage: the allowance is a lower bound now.
    assert monitor.remaining_output_tokens() is None


def test_the_bound_is_omitted_once_the_served_usage_is_a_lower_bound():
    turns = (
        _turn(
            tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),),
            prompt_tokens=30,
            completion_tokens=None,  # the endpoint discarded one field
        ),
        _turn(content="done"),
    )
    model = ScriptedLoopModel(turns)
    loop, _, monitor = _loop(model, budget=run_budget(max_total_tokens=100))
    asyncio.run(loop.run("q"))

    assert model.requests[0]["max_output_tokens"] == 100
    # A lower bound cannot say how much remains: the field is omitted (the
    # deployed only-when-configured rule), never guessed.
    assert model.requests[1]["max_output_tokens"] is None
    assert monitor.remaining_output_tokens() is None


def test_spent_tokens_refuse_the_next_model_call():
    turns = (
        _turn(
            tool_calls=(_tool_call("call-1", "search_knowledge", {"query": "q"}),),
            prompt_tokens=70,
            completion_tokens=30,
        ),
        _turn(content="never reached"),
    )
    loop, collector, monitor = _loop(ScriptedLoopModel(turns), budget=run_budget(max_total_tokens=100))
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert result.final_text is None
    assert result.prompt_tokens == 70 and result.completion_tokens == 30  # the honest partials
    assert collector[-1].kind.value == "run_error"
    assert collector[-1].payload["code"] == OUTCOME_BUDGET_EXHAUSTED
    assert "token budget" in collector[-1].payload["message"]


def test_tool_results_accumulate_the_run_evidence():
    loop, _, monitor = _loop(ScriptedLoopModel(MULTI_HOP_TURNS))
    result = asyncio.run(loop.run("q"))
    assert result.evidence_bytes > 0
    assert monitor.evidence_bytes == result.evidence_bytes


def test_spent_evidence_refuses_the_next_tool_dispatch():
    two_calls = _turn(
        tool_calls=(
            _tool_call("call-1", "search_knowledge", {"query": "q"}),
            _tool_call("call-2", "read_source", {"target": {"file_id": "f-1"}}),
        )
    )
    loop, collector, monitor = _loop(
        ScriptedLoopModel((two_calls, _turn(content="unused"))),
        budget=run_budget(max_evidence_bytes=1),
    )
    result = asyncio.run(loop.run("q"))

    assert result.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert result.final_text is None
    assert "evidence-volume budget" in result.error
    assert monitor.tool_calls == 1  # the refused dispatch never counted
    assert monitor.evidence_bytes >= 1  # the executed result is the evidence
    # The checks precede the started event: the refused dispatch never
    # announced a tool call that did not run.
    assert [event.kind.value for event in collector] == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "run_error",
    ]


# ---------------------------------------------------------------------
# The split finalize: the judge never delays first chunk
# ---------------------------------------------------------------------


def test_the_judge_runs_after_the_text_events_never_before_the_first_chunk():
    """The finalize is split around the text events: the judged call (the
    finalize's only latency) happens AFTER text_message_finished and BEFORE
    the verdict event — a hung-judge latency can never sit between the run
    start and the first chunk."""
    sequence: list[str] = []

    class RecordingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            sequence.append("judge-call")
            return ModelTurn(content='{"verdict": "grounded"}')

    monitor = RunBudgetMonitor(DEFAULT_BUDGET)
    verifier = VerificationPipeline(
        policy="verdict-marked",
        judge_timeout_ms=5000,
        judge_model_client=RecordingJudgeModel(),
        monitor=monitor,
        authorized_repos=PROBE_CONTEXT.authorized_repos,
    )
    loop = AgentLoop(
        model=ScriptedLoopModel(MULTI_HOP_TURNS),
        registry=document_toolset(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET),
        monitor=monitor,
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1", sink=lambda event: sequence.append(event.kind.value)),
        system_prompt="the production prompt",
        verifier=verifier,
    )

    asyncio.run(loop.run("q"))

    assert sequence == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "tool_call_started",
        "tool_call_finished",
        "text_message_started",
        "text_message_content",
        "text_message_finished",
        "judge-call",  # the judged latency sits AFTER the last text event
        "verdict",
        "run_finished",
    ]


def test_a_missing_query_argument_is_structured_tool_feedback_on_both_toolset_paths():
    """The search executor's argument validation (probe and prepared paths
    alike) refuses a missing query with the pydantic ValidationError the
    loop maps to the structured tool result — the run survives, the model
    sees the refusal as data, and the port is never reached."""

    class _RecordingPreparer:
        def __init__(self):
            self.calls = []

        async def prepare(self, text, source_language=None):
            self.calls.append(text)
            raise AssertionError("the refusal must precede preparation")

    for preparer in (None, _RecordingPreparer()):
        port = _port()
        loop, collector, _ = _loop(
            ScriptedLoopModel(
                (
                    _turn(tool_calls=(_tool_call("call-1", "search_knowledge", {}),)),
                    _turn(content="the search refused my empty query; I answer from what I have."),
                )
            ),
            port=port,
            registry=document_toolset(port, PROBE_CONTEXT, PROBE_OPERATION_BUDGET, preparer=preparer),
        )
        result = asyncio.run(loop.run("q"))

        assert result.outcome == OUTCOME_ANSWERED  # the run survived the bad argument
        finished = next(event for event in collector if event.kind.value == "tool_call_finished")
        assert finished.payload["error"]["code"] == "invalid_arguments"
        assert port.search_calls == []  # the port was never reached
        # The message list carried the structured error back to the model.
        served = [m for request in loop.model.requests for m in request["messages"]]
        assert any(m.get("role") == "tool" and "invalid_arguments" in m.get("content", "") for m in served)
