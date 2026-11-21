# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The bounded smoke probe — the evidence producer and its pieces.

Mutation-sensitive pins: the toolset is exactly search + read over the port
(the executors adapt arguments into the contract's types — English
passthrough, closed SourceRef union, extra argument fields refused), the
probe run produces the comparable evidence record (outcome, counts,
wall clock, usage as served) for every terminal shape — answered, error,
budget-exhausted, cancelled — and the probe-local model client mirrors the
recorded generation conventions (fixed params, tools carried, override-first
model id, typed transient failures).
"""

import asyncio
import json

import pytest
from conftest import AgentFakePort, PreparationFakeTransport, ScriptedLoopModel, preparation_model_entry

from agent.budget import RunBudget
from agent.cancellation import CancellationToken
from agent.loop import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_CANCELLED,
    OUTCOME_ERROR,
    ModelTurn,
    ToolCallRequest,
)
from agent.probe import (
    PROBE_OPERATION_BUDGET,
    PROBE_QUESTION,
    QUESTION_ID,
    RUNTIME_ID,
    TOOLSET,
    ProbeConfig,
    ProbeModelClient,
    ProbeTransientError,
    build_port,
    document_toolset,
    run_probe,
)
from capabilities.contract import (
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OutcomeCode,
    QueryPreparationStatus,
    ReadSourceResult,
    SearchHit,
    SearchKnowledgeResult,
)

PROBE_CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))


def _search_result(*, concept=False):
    provenance = (
        OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)
        if concept
        else LegacyFileProvenance(file_id="f-1")
    )
    return SearchKnowledgeResult(
        outcome=OutcomeCode.SUCCESS,
        hits=(SearchHit(provenance=provenance, text="the passage", score=0.9),),
        query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
    )


def _read_result():
    return ReadSourceResult(
        outcome=OutcomeCode.SUCCESS,
        provenance=LegacyFileProvenance(file_id="f-1"),
        content="the content",
    )


def _port() -> AgentFakePort:
    return AgentFakePort(search_result=_search_result(), read_result=_read_result())


def _turns(content="the answer"):
    return (
        ModelTurn(tool_calls=(ToolCallRequest(call_id="call-1", name="search_knowledge", arguments={"query": "q"}),)),
        ModelTurn(
            tool_calls=(
                ToolCallRequest(call_id="call-2", name="read_source", arguments={"target": {"file_id": "f-1"}}),
            )
        ),
        ModelTurn(content=content),
    )


# ---------------------------------------------------------------------
# The toolset: exactly search + read, executors bound to the port
# ---------------------------------------------------------------------


def test_the_toolset_is_exactly_the_two_document_tools():
    registry = document_toolset(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    assert registry.names() == ("search_knowledge", "read_source")
    assert [definition["function"]["name"] for definition in registry.definitions()] == list(TOOLSET)


def test_the_search_executor_adapts_arguments_into_the_contract_types():
    port = _port()
    registry = document_toolset(port, PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "complaint handling"}))

    call = port.search_calls[0]
    assert call["request"].query.text == "complaint handling"
    # The probe question is English by construction: passthrough, no
    # preparation call in the loop.
    assert call["request"].query.preparation_status == QueryPreparationStatus.PASSTHROUGH_ENGLISH
    assert call["context"] == PROBE_CONTEXT
    assert call["budget"] == PROBE_OPERATION_BUDGET
    assert result == _search_result().model_dump(mode="json")


def test_the_read_executor_resolves_both_source_ref_variants():
    port = _port()
    registry = document_toolset(port, PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    legacy = asyncio.run(registry.dispatch("read_source", {"target": {"file_id": "f-1"}}))
    okf = asyncio.run(registry.dispatch("read_source", {"target": {"repo_id": "r-1", "concept_id": "c-1"}}))

    assert port.read_calls[0]["request"].target.file_id == "f-1"
    assert port.read_calls[1]["request"].target.repo_id == "r-1"
    assert port.read_calls[1]["request"].target.concept_id == "c-1"
    assert legacy["provenance"] == {"file_id": "f-1"}
    assert okf["outcome"] == "success"  # both dispatches completed on the canned card


def test_the_contract_refuses_malformed_arguments_and_smuggled_target_fields():
    registry = document_toolset(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        asyncio.run(registry.dispatch("search_knowledge", {}))  # no query
    with pytest.raises(ValidationError):
        # extra="forbid" on the contract's SourceRef union: the model
        # cannot smuggle a field into the target
        asyncio.run(registry.dispatch("read_source", {"target": {"file_id": "f-1", "graph_name": "other"}}))
    with pytest.raises(ValidationError):
        asyncio.run(registry.dispatch("read_source", {"target": {"concept_id": "c-1"}}))  # no repo_id


def test_smuggled_argument_fields_change_nothing_the_port_sees():
    # The query is the only thing the model contributes: a smuggled
    # scope field in the arguments is dead weight — the narrowing travels
    # in the fixed context, never in the arguments.
    port = _port()
    registry = document_toolset(port, PROBE_CONTEXT, PROBE_OPERATION_BUDGET)
    asyncio.run(registry.dispatch("search_knowledge", {"query": "q", "graph_name": "other", "user_id": "attacker"}))
    call = port.search_calls[0]
    assert call["request"].query.text == "q"
    assert call["context"] == PROBE_CONTEXT


# ---------------------------------------------------------------------
# The probe run: one record per run, comparable across candidates
# ---------------------------------------------------------------------


def test_the_probe_records_the_answered_multihop_run():
    evidence = asyncio.run(run_probe(port=_port(), context=PROBE_CONTEXT, model_client=ScriptedLoopModel(_turns())))

    assert evidence.runtime_id == RUNTIME_ID == "custom-minimal-loop"
    assert evidence.toolset == ("search_knowledge", "read_source")
    assert evidence.question_id == QUESTION_ID == "probe-multihop-001"
    assert evidence.outcome == OUTCOME_ANSWERED
    assert (evidence.steps, evidence.model_calls, evidence.tool_calls) == (3, 3, 2)
    assert evidence.wall_clock_seconds >= 0
    assert evidence.error is None
    dumped = json.dumps(evidence.as_dict())
    assert json.loads(dumped)["outcome"] == OUTCOME_ANSWERED


def test_the_probe_default_question_is_the_one_multihop_question():
    assert PROBE_QUESTION.strip().endswith("?")


def test_the_probe_records_an_unregistered_dispatch_as_an_error():
    turns = (ModelTurn(tool_calls=(ToolCallRequest(call_id="c-1", name="not_a_tool", arguments={}),)),)
    evidence = asyncio.run(run_probe(port=_port(), context=PROBE_CONTEXT, model_client=ScriptedLoopModel(turns)))
    assert evidence.outcome == OUTCOME_ERROR
    assert "not_a_tool" in evidence.error


def test_the_probe_records_budget_exhaustion_with_the_smoke_bounds_overridden():
    evidence = asyncio.run(
        run_probe(
            port=_port(),
            context=PROBE_CONTEXT,
            model_client=ScriptedLoopModel(_turns()),
            run_budget=RunBudget(max_steps=6, max_model_calls=1, max_tool_calls=6, wall_clock_seconds=30.0),
        )
    )
    assert evidence.outcome == OUTCOME_BUDGET_EXHAUSTED
    assert evidence.model_calls == 1  # the refused model call never counted
    assert evidence.steps == 2  # the second iteration opened, but its model call was refused


def test_a_cancelled_probe_records_outcome_cancelled():
    recorder: dict = {}
    token = CancellationToken()

    class HangingModel:
        async def complete(self, messages, tool_definitions):
            recorder["started"] = True
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                recorder["cancelled_in_flight"] = True
                raise

    async def scenario():
        async def fire_when_running():
            while "started" not in recorder:
                await asyncio.sleep(0)
            token.cancel()

        asyncio.get_running_loop().create_task(fire_when_running())
        return await run_probe(port=_port(), context=PROBE_CONTEXT, model_client=HangingModel(), token=token)

    evidence = asyncio.run(scenario())
    assert evidence.outcome == OUTCOME_CANCELLED
    assert recorder["cancelled_in_flight"] is True  # the cancellation reached the in-flight call
    assert (evidence.steps, evidence.model_calls, evidence.tool_calls) == (1, 1, 0)  # the partial counts survive


def test_the_probe_records_usage_when_the_endpoint_serves_it():
    turns = (
        ModelTurn(
            tool_calls=(ToolCallRequest(call_id="call-1", name="search_knowledge", arguments={"query": "q"}),),
            prompt_tokens=101,
            completion_tokens=23,
        ),
        ModelTurn(content="the answer", prompt_tokens=9, completion_tokens=4),
    )
    evidence = asyncio.run(run_probe(port=_port(), context=PROBE_CONTEXT, model_client=ScriptedLoopModel(turns)))
    assert (evidence.prompt_tokens, evidence.completion_tokens) == (110, 27)


# ---------------------------------------------------------------------
# The probe-local model client: the recorded conventions
# ---------------------------------------------------------------------


ENDPOINT = "http://llm.invalid"


def _probe_config(**overrides) -> ProbeConfig:
    values = {"VLLM_LLM_ENDPOINT": ENDPOINT, "VLLM_LLM_MODEL_ID": "served-model"}
    return ProbeConfig.load(env={**values, **overrides})


# ---------------------------------------------------------------------
# The config: the recorded bearer convention and tolerant timeout reads
# ---------------------------------------------------------------------


def test_the_generation_bearer_falls_back_to_the_gpu_node_key():
    # The canonical venue carries only VLLM_API_KEY (the GPU key): the
    # in-process probe inherits the operator's shell, not a compose
    # mapping, so without the fallback the first generation call 401s.
    config = ProbeConfig.load(env={"VLLM_API_KEY": "gpu-key"})
    assert config.bearer == "gpu-key"


def test_the_recorded_bearer_wins_when_both_keys_are_set():
    config = ProbeConfig.load(env={"OPENAI_API_KEY": "recorded", "VLLM_API_KEY": "gpu"})
    assert config.bearer == "recorded"
    assert config.probe_bearer == "gpu"


@pytest.mark.parametrize("knob,default", [("MODEL_LLM_TIMEOUT_SECONDS", 180.0), ("MODEL_PROBE_TIMEOUT_SECONDS", 10.0)])
def test_a_set_to_empty_timeout_knob_falls_back_to_its_default(knob, default):
    # The recorded convention (the tolerant _env_float read): an
    # empty value is unset, never a startup crash.
    config = ProbeConfig.load(env={knob: ""})
    field = "llm_timeout_seconds" if knob == "MODEL_LLM_TIMEOUT_SECONDS" else "probe_timeout_seconds"
    assert getattr(config, field) == default


def _chat_body(content=None, tool_calls=None, finish_reason="stop", usage=None):
    message = {}
    if content is not None:
        message["content"] = content
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message, "finish_reason": finish_reason}], "usage": usage or {}}


def _transport(chat_answer, model_entry=None):
    return PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/models": model_entry or preparation_model_entry(),
            f"{ENDPOINT}/v1/chat/completions": chat_answer,
        }
    )


def test_complete_sends_the_recorded_payload_and_parses_a_tool_call_turn():
    transport = _transport(
        (
            200,
            _chat_body(
                tool_calls=[
                    {
                        "id": "tc-1",
                        "type": "function",
                        "function": {"name": "search_knowledge", "arguments": '{"query": "q"}'},
                    }
                ],
                finish_reason="tool_calls",
                usage={"prompt_tokens": 101, "completion_tokens": 23},
            ),
        )
    )
    client = ProbeModelClient(_probe_config(), transport=transport)
    turn = asyncio.run(client.complete([{"role": "user", "content": "q"}], ({"type": "function"},)))

    assert turn.content is None
    assert turn.tool_calls == (ToolCallRequest(call_id="tc-1", name="search_knowledge", arguments={"query": "q"}),)
    assert turn.finish_reason == "tool_calls"
    assert (turn.prompt_tokens, turn.completion_tokens) == (101, 23)
    payload = transport.calls[-1]["payload"]
    assert payload["model"] == "served-model"
    assert payload["temperature"] == 0.01
    assert payload["top_p"] == 0.95
    assert payload["frequency_penalty"] == 0.0
    assert payload["stream"] is False
    assert payload["tools"] == [{"type": "function"}]
    assert payload["tool_choice"] == "auto"


def test_complete_carries_the_bearer_when_configured():
    transport = _transport((200, _chat_body(content="a")))
    config = _probe_config(OPENAI_API_KEY="sk-data")
    asyncio.run(ProbeModelClient(config, transport=transport).complete([], ()))
    assert transport.calls[-1]["headers"] == {"Authorization": "Bearer sk-data"}


def test_the_model_id_override_means_no_discovery_probe():
    transport = _transport((200, _chat_body(content="a")))
    asyncio.run(ProbeModelClient(_probe_config(), transport=transport).complete([], ()))
    assert [call["url"] for call in transport.calls] == [f"{ENDPOINT}/v1/chat/completions"]


def test_the_model_id_is_discovered_when_no_override_is_set():
    transport = _transport(
        (200, _chat_body(content="a")), model_entry=preparation_model_entry(model_id="discovered-model")
    )
    client = ProbeModelClient(_probe_config(VLLM_LLM_MODEL_ID=""), transport=transport)
    asyncio.run(client.complete([], ()))
    assert [call["url"] for call in transport.calls] == [f"{ENDPOINT}/v1/models", f"{ENDPOINT}/v1/chat/completions"]
    assert transport.calls[-1]["payload"]["model"] == "discovered-model"


def test_every_failure_shape_is_the_typed_transient():
    config = _probe_config()
    with pytest.raises(ProbeTransientError, match="answered 500"):
        asyncio.run(ProbeModelClient(config, transport=_transport((500, "boom"))).complete([], ()))
    with pytest.raises(ProbeTransientError, match="no choice"):
        asyncio.run(ProbeModelClient(config, transport=_transport((200, {"choices": []}))).complete([], ()))
    with pytest.raises(ProbeTransientError, match="not valid JSON"):
        asyncio.run(
            ProbeModelClient(
                config,
                transport=_transport(
                    (
                        200,
                        _chat_body(
                            tool_calls=[
                                {"id": "tc-1", "type": "function", "function": {"name": "t", "arguments": "not-json"}}
                            ]
                        ),
                    )
                ),
            ).complete([], ())
        )
    with pytest.raises(ProbeTransientError, match="discovery failed"):
        asyncio.run(
            ProbeModelClient(
                _probe_config(VLLM_LLM_MODEL_ID=""), transport=PreparationFakeTransport(error=OSError("down"))
            ).complete([], ())
        )


def test_a_non_object_tool_arguments_payload_is_refused():
    transport = _transport(
        (
            200,
            _chat_body(
                tool_calls=[{"id": "tc-1", "type": "function", "function": {"name": "t", "arguments": "[1, 2]"}}]
            ),
        )
    )
    with pytest.raises(ProbeTransientError, match="not a JSON object"):
        asyncio.run(ProbeModelClient(_probe_config(), transport=transport).complete([], ()))


def test_a_tool_call_without_an_id_is_a_response_shape_defect():
    # The loop echoes the id back as tool_call_id on the follow-up request;
    # an empty shared id would be rejected by a strict OpenAI-compatible
    # server on the NEXT call, disguising a response-shape defect as a
    # transient failure. The probe names it here instead.
    transport = _transport(
        (
            200,
            _chat_body(
                tool_calls=[{"type": "function", "function": {"name": "t", "arguments": "{}"}}],
            ),
        )
    )
    with pytest.raises(ProbeTransientError, match="carries no id"):
        asyncio.run(ProbeModelClient(_probe_config(), transport=transport).complete([], ()))


# ---------------------------------------------------------------------
# The live assembly: the port and its caller context from the env knobs
# ---------------------------------------------------------------------


def _live_env(**overrides):
    values = {
        "TEI_EMBEDDING_ENDPOINT": "http://tei.invalid/embed",
        "TEI_RERANKING_ENDPOINT": "http://rerank.invalid",
        "ARANGO_URL": "http://arango.invalid:8529",
        "AGENT_DOCREPO_URL": "http://docrepo.invalid",
        "AGENT_OKF_URL": "http://okf.invalid",
        "AGENT_AUTHORIZED_GRAPHS": "GRAPH",
    }
    return {**values, **overrides}


def test_build_port_assembles_the_executor_and_its_context():
    port, context = build_port(ProbeConfig.load(env=_live_env()), env=_live_env())
    assert context.user_id == "probe-smoke"
    assert context.authorized_graph_names == ("GRAPH",)
    # The executor enforces the context's set — the probe caller walks the
    # same authorization path a request takes.
    assert hasattr(port, "read_source")


def test_build_port_resolves_authorized_repo_pairs():
    env = _live_env(AGENT_AUTHORIZED_REPOS="repo-a:GRAPH, repo-b:GRAPH")
    _, context = build_port(ProbeConfig.load(env=env), env=env)
    assert [(repo.repo_id, repo.graph_name) for repo in context.authorized_repos] == [
        ("repo-a", "GRAPH"),
        ("repo-b", "GRAPH"),
    ]


def test_build_port_refuses_a_malformed_repo_pair():
    env = _live_env(AGENT_AUTHORIZED_REPOS="repo-a")
    with pytest.raises(ValueError, match="repo_id:graph_name"):
        build_port(ProbeConfig.load(env=env), env=env)


@pytest.mark.parametrize("knob", ["AGENT_DOCREPO_URL", "AGENT_OKF_URL", "AGENT_AUTHORIZED_GRAPHS"])
def test_build_port_refuses_a_missing_knob_by_name(knob):
    env = _live_env()
    del env[knob]
    with pytest.raises(ValueError, match=knob):
        build_port(ProbeConfig.load(env=env), env=env)
