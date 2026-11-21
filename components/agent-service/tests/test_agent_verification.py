# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The V06 verification harness — cell judgment, streaming reassembly, cancellation demos.

Every path runs on fakes: the suite is deterministic and CI carries no live
endpoint. The judgment contract is pinned mechanically — a malformed call is
an invalid cell WITH its reasons, never an exception, never a skip; a
transport failure is a failed cell; the cancellation demos record what
happened (CancelledError propagates, no terminal event, the in-flight call
cancelled) instead of asserting a venue's mood.
"""

import asyncio
import contextlib
import json
from dataclasses import replace

import httpx
import pytest
from conftest import PreparationFakeTransport

from agent.probe import ProbeConfig
from agent.verification import (
    SCHEMA_STRICTNESS,
    SCHEMAS,
    TOOL_CHOICE_MODES,
    TOOL_NAME,
    CellRecord,
    EndpointIdentity,
    HttpxSseStream,
    LoopCancelObservation,
    PlainControlObservation,
    StreamingCancelObservation,
    ToolCallObservation,
    VerificationEvidence,
    VerificationTransientError,
    acceptance_verdict,
    demo_loop_cancel,
    demo_streaming_cancel,
    judge_cell,
    judge_streaming_reassembly,
    markup_leak,
    parse_nonstreaming_tool_calls,
    parse_sse_payload,
    read_endpoint_identity,
    reassemble_streaming_tool_calls,
    run_cell,
    run_matrix,
    run_plain_control,
    run_verification,
    tool_choice_value,
    validate_arguments,
)

ENDPOINT = "http://llm.invalid"

STRICT = SCHEMAS["strict"]
PERMISSIVE = SCHEMAS["permissive"]


def _config(**overrides) -> ProbeConfig:
    values = {"VLLM_LLM_ENDPOINT": ENDPOINT, "VLLM_LLM_MODEL_ID": "served-model"}
    return ProbeConfig.load(env={**values, **overrides})


# ---------------------------------------------------------------------
# The judgment: the registered schema subset, checked mechanically
# ---------------------------------------------------------------------


def test_strict_arguments_that_match_the_schema_pass():
    assert validate_arguments({"query": "q", "max_results": 3}, STRICT) == ()


def test_missing_required_and_extra_properties_are_named():
    reasons = validate_arguments({"query": "q"}, STRICT)
    assert any("max_results" in reason for reason in reasons)
    reasons = validate_arguments({"query": "q", "max_results": 3, "graph": "other"}, STRICT)
    assert any("'graph'" in reason for reason in reasons)


def test_a_wrong_property_type_is_named():
    reasons = validate_arguments({"query": "q", "max_results": "three"}, STRICT)
    assert any("'max_results'" in reason and "integer" in reason for reason in reasons)


def test_the_permissive_schema_tolerates_extra_properties():
    assert validate_arguments({"query": "q", "anything": True}, PERMISSIVE) == ()
    assert any("query" in reason for reason in validate_arguments({}, PERMISSIVE))


def test_a_non_object_arguments_payload_is_refused():
    assert validate_arguments("not-an-object", STRICT) == ("the tool-call arguments are not a JSON object",)  # type: ignore[arg-type]


# ---------------------------------------------------------------------
# The markup-leak check
# ---------------------------------------------------------------------


@pytest.mark.parametrize("marker", ["<tool_call>", "</tool_call>", "<|python_tag|>", "<function=", "[TOOL_CALL]"])
def test_every_registered_markup_marker_is_detected(marker):
    assert markup_leak(f"Here is my answer {marker} more") == marker


def test_clean_content_carries_no_markup():
    assert markup_leak("A plain answer about the remote-work policy.") is None
    assert markup_leak(None) is None


# ---------------------------------------------------------------------
# The non-streaming parse: lenient — issues, never exceptions
# ---------------------------------------------------------------------


def _message(tool_calls=None, content=None):
    message = {}
    if content is not None:
        message["content"] = content
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return message


def test_a_wellformed_tool_call_parses_clean():
    observation = parse_nonstreaming_tool_calls(
        _message(
            tool_calls=[
                {
                    "id": "tc-1",
                    "type": "function",
                    "function": {"name": TOOL_NAME, "arguments": '{"query": "q", "max_results": 3}'},
                }
            ],
            content="",
        ),
        TOOL_NAME,
    )
    assert len(observation.calls) == 1
    call = observation.calls[0]
    assert call.id == "tc-1"
    assert call.name == TOOL_NAME
    assert call.arguments == {"query": "q", "max_results": 3}
    assert call.issues == ()


def test_the_parse_records_issues_instead_of_raising():
    observation = parse_nonstreaming_tool_calls(
        _message(
            tool_calls=[
                {"type": "function", "function": {"name": "other_tool", "arguments": "not-json"}},
                "not-even-a-dict",
            ],
        ),
        TOOL_NAME,
    )
    assert len(observation.calls) == 2
    assert any("carries no id" in issue for issue in observation.calls[0].issues)
    assert any("not valid JSON" in issue for issue in observation.calls[0].issues)
    assert any("names 'other_tool'" in issue for issue in observation.calls[0].issues)
    assert observation.calls[1].arguments is None
    assert observation.calls[1].issues == ("malformed tool call entry",)


def test_a_non_list_tool_calls_field_is_an_issue_not_a_crash():
    observation = parse_nonstreaming_tool_calls(_message(tool_calls={"id": "tc-1"}), TOOL_NAME)
    assert observation.calls[0].issues == ("malformed tool_calls field",)


def test_a_non_object_arguments_payload_is_an_issue():
    observation = parse_nonstreaming_tool_calls(
        _message(tool_calls=[{"id": "tc-1", "function": {"name": TOOL_NAME, "arguments": "[1, 2]"}}]),
        TOOL_NAME,
    )
    assert observation.calls[0].arguments is None
    assert any("not a JSON object" in issue for issue in observation.calls[0].issues)


# ---------------------------------------------------------------------
# The streaming reassembly: deltas rebuild complete calls
# ---------------------------------------------------------------------


def _sse_events(*, with_id=True, name=TOOL_NAME, arg_parts=('{"query": "remote work", ', '"max_results": 3}')):
    first_delta = {"index": 0, "type": "function", "function": {"name": name, "arguments": arg_parts[0]}}
    if with_id:
        first_delta["id"] = "tc-1"
    return [
        {"choices": [{"delta": {"role": "assistant", "tool_calls": [first_delta]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": arg_parts[1]}}]}}]},
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ]


def test_split_argument_deltas_reassemble_into_a_complete_call():
    observation = reassemble_streaming_tool_calls(_sse_events(), TOOL_NAME)
    assert observation.delta_count == 3
    assert observation.finish_reason == "tool_calls"
    assert len(observation.calls) == 1
    call = observation.calls[0]
    assert call.id == "tc-1"
    assert call.name == TOOL_NAME
    assert call.arguments == {"query": "remote work", "max_results": 3}
    assert call.issues == ()


def test_streamed_content_accumulates_and_finish_reason_is_taken():
    events = [
        {"choices": [{"delta": {"content": "partial "}}]},
        {"choices": [{"delta": {"content": "answer"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    observation = reassemble_streaming_tool_calls(events, TOOL_NAME)
    assert observation.content == "partial answer"
    assert observation.finish_reason == "stop"
    assert observation.calls == ()


def test_a_stream_missing_the_call_id_is_an_issue():
    observation = reassemble_streaming_tool_calls(_sse_events(with_id=False), TOOL_NAME)
    assert any("no streamed delta carried the call id" in issue for issue in observation.calls[0].issues)


def test_a_wrong_streamed_name_is_an_issue():
    observation = reassemble_streaming_tool_calls(_sse_events(name="other_tool"), TOOL_NAME)
    assert any("names 'other_tool'" in issue for issue in observation.calls[0].issues)


def test_unparseable_reassembled_arguments_are_an_issue():
    observation = reassemble_streaming_tool_calls(_sse_events(arg_parts=("{bad", " json}")), TOOL_NAME)
    assert observation.calls[0].arguments is None
    assert any("not valid JSON" in issue for issue in observation.calls[0].issues)


def test_a_malformed_tool_call_delta_is_recorded_not_raised():
    events = [
        {"choices": [{"delta": {"tool_calls": ["not-a-dict"]}}]},
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ]
    observation = reassemble_streaming_tool_calls(events, TOOL_NAME)
    assert observation.error == "a streamed tool-call delta is not an object"


def test_events_without_choices_are_ignored():
    observation = reassemble_streaming_tool_calls([{"choices": []}, "not-a-dict", *_sse_events()], TOOL_NAME)
    assert observation.delta_count == 3


# ---------------------------------------------------------------------
# The per-cell verdict
# ---------------------------------------------------------------------


def test_a_valid_tool_call_cell_is_valid():
    observation = parse_nonstreaming_tool_calls(
        _message(
            tool_calls=[
                {"id": "tc-1", "function": {"name": TOOL_NAME, "arguments": '{"query": "q", "max_results": 3}'}}
            ]
        ),
        TOOL_NAME,
    )
    valid, reasons = judge_cell(observation, STRICT)
    assert valid is True
    assert reasons == ()


def test_a_text_only_answer_fails_the_cell_with_its_reason():
    observation = ToolCallObservation(content="I know this from memory.", finish_reason="stop", calls=())
    valid, reasons = judge_cell(observation, STRICT)
    assert valid is False
    assert any("no tool call was issued" in reason and "stop" in reason for reason in reasons)


def test_malformed_arguments_make_the_cell_invalid():
    observation = parse_nonstreaming_tool_calls(
        _message(tool_calls=[{"id": "tc-1", "function": {"name": TOOL_NAME, "arguments": '{"query": "q"}'}}]),
        TOOL_NAME,
    )
    valid, reasons = judge_cell(observation, STRICT)
    assert valid is False
    assert any("max_results" in reason for reason in reasons)


def test_markup_leak_into_content_makes_the_cell_invalid():
    observation = ToolCallObservation(
        content='<tool_call>{"name": "search_knowledge"}</tool_call>',
        finish_reason="stop",
        calls=(),
    )
    valid, reasons = judge_cell(observation, STRICT)
    assert valid is False
    assert any("markup leaked" in reason for reason in reasons)


def test_the_streaming_judge_demands_real_tool_call_deltas():
    single_blob = ToolCallObservation(
        content=None, finish_reason="tool_calls", calls=(), delta_count=1, tool_delta_count=1
    )
    valid, reasons = judge_streaming_reassembly(single_blob, STRICT)
    assert valid is False
    assert any("did not stream as tool-call deltas" in reason for reason in reasons)
    valid, _ = judge_streaming_reassembly(
        reassemble_streaming_tool_calls(_sse_events(), TOOL_NAME),
        SCHEMAS["strict"],
    )
    assert valid is True


def test_a_blob_call_amid_content_deltas_is_judged_invalid():
    # The no-blob contract judges TOOL-CALL deltas: a whole-call blob amid
    # content deltas has plenty of total deltas and still fails — the call
    # itself never streamed as deltas.
    events = [
        {"choices": [{"delta": {"content": "Let me search. "}}]},
        {"choices": [{"delta": {"content": "Here:"}}]},
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "tc-1",
                                "type": "function",
                                "function": {
                                    "name": TOOL_NAME,
                                    "arguments": '{"query": "remote work", "max_results": 3}',
                                },
                            }
                        ]
                    }
                }
            ]
        },
        {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
    ]
    observation = reassemble_streaming_tool_calls(events, TOOL_NAME)
    assert observation.delta_count == 4
    assert observation.tool_delta_count == 1
    assert observation.calls[0].arguments == {"query": "remote work", "max_results": 3}
    valid, reasons = judge_streaming_reassembly(observation, SCHEMAS["strict"])
    assert valid is False
    assert any("did not stream as tool-call deltas" in reason for reason in reasons)


# ---------------------------------------------------------------------
# The SSE payload reader
# ---------------------------------------------------------------------


def test_parse_sse_payload_returns_done_sentinel_as_none():
    assert parse_sse_payload("[DONE]") is None


def test_parse_sse_payload_parses_the_json_object():
    assert parse_sse_payload('{"choices": []}') == {"choices": []}


def test_parse_sse_payload_raises_on_non_json():
    with pytest.raises(ValueError):
        parse_sse_payload("not-json")


_SSE_WIRE = (
    b'data: {"choices": [{"delta": {"role": "assistant"}}]}\n\n'
    b": keep-alive comment\n\n"
    b'data: {"choices": [{"delta": {"content": "hi"}}]}\n\n'
    b"data: [DONE]\n\n"
)


def test_the_live_sse_read_parses_events_and_stops_at_done():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL(f"{ENDPOINT}/v1/chat/completions")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_SSE_WIRE)

    stream = HttpxSseStream(
        f"{ENDPOINT}/v1/chat/completions",
        {"Authorization": "Bearer k"},
        {"stream": True},
        verify=True,
        timeout_s=5.0,
        transport=httpx.MockTransport(handler),
    )

    async def scenario():
        events = [event async for event in stream.events()]
        await stream.aclose()  # the drained stream's client is closed by its consumer
        return events

    events = asyncio.run(scenario())
    assert len(events) == 2
    assert events[1]["choices"][0]["delta"] == {"content": "hi"}
    assert stream.connection_closed is True  # the drained stream tore down


def test_the_live_sse_read_raises_the_typed_error_on_an_http_failure():
    stream = HttpxSseStream(
        f"{ENDPOINT}/v1/chat/completions",
        {},
        {},
        verify=True,
        timeout_s=5.0,
        transport=httpx.MockTransport(lambda request: httpx.Response(503, content=b"down")),
    )

    async def scenario():
        return [event async for event in stream.events()]

    with pytest.raises(VerificationTransientError, match="answered 503"):
        asyncio.run(scenario())


def test_a_200_json_body_is_not_read_as_an_eventless_stream():
    # A 200 with a JSON body (an error envelope some gateways serve) must
    # raise, not read as a stream that issued no tool call.
    stream = HttpxSseStream(
        f"{ENDPOINT}/v1/chat/completions",
        {},
        {},
        verify=True,
        timeout_s=5.0,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, headers={"content-type": "application/json"}, content=b'{"error": "boom"}'
            )
        ),
    )

    async def scenario():
        return [event async for event in stream.events()]

    with pytest.raises(VerificationTransientError, match="not an event stream"):
        asyncio.run(scenario())


def test_the_stream_records_its_teardown_when_cancelled_mid_read():
    # The teardown is observable: the flag flips when the response/client
    # context blocks unwind — forced here by aclose() after cancelling a
    # read that was still open.
    async def slow_body():
        yield b'data: {"choices": [{"delta": {"content": "first"}}]}\n\n'
        await asyncio.Event().wait()  # the read stays open until cancelled

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=slow_body())

    stream = HttpxSseStream(
        f"{ENDPOINT}/v1/chat/completions",
        {},
        {},
        verify=True,
        timeout_s=5.0,
        transport=httpx.MockTransport(handler),
    )

    async def scenario():
        agen = stream.events()
        first = await agen.__anext__()
        reader = asyncio.ensure_future(agen.__anext__())  # parks on the open read
        await asyncio.sleep(0)
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
        # The cancelled read's unwind already set the flag (the finally is
        # await-free — no GeneratorExit trap), deterministically, not by GC.
        assert stream.connection_closed is True
        await stream.aclose()  # closes response + client as ordinary awaits
        assert stream.connection_closed is True  # idempotent
        return first

    first = asyncio.run(scenario())
    assert first["choices"][0]["delta"] == {"content": "first"}
    assert stream.connection_closed is True


# ---------------------------------------------------------------------
# The matrix cell runner on fakes
# ---------------------------------------------------------------------


def _chat_body(tool_calls=None, content="searching", finish_reason="tool_calls"):
    message = {"content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message, "finish_reason": finish_reason}], "usage": {}}


def _transport(chat_answer):
    return PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/models": (200, {"data": [{"id": "served-model", "max_model_len": 8192}]}),
            f"{ENDPOINT}/version": (200, {"version": "v0.29.0"}),
            f"{ENDPOINT}/v1/chat/completions": chat_answer,
        }
    )


def _valid_call_body():
    return _chat_body(
        tool_calls=[
            {
                "id": "tc-1",
                "type": "function",
                "function": {"name": TOOL_NAME, "arguments": '{"query": "remote work", "max_results": 3}'},
            }
        ],
    )


@pytest.mark.parametrize(
    "mode,wire",
    [("auto", "auto"), ("required", "required"), ("named", {"type": "function", "function": {"name": TOOL_NAME}})],
)
def test_a_nonstreaming_cell_sends_the_recorded_payload_conventions(mode, wire):
    transport = _transport((200, _valid_call_body()))
    record = asyncio.run(run_cell(_config(), transport, "served-model", mode, "strict", streaming=False))

    payload = transport.calls[-1]["payload"]
    assert payload["model"] == "served-model"
    assert payload["tool_choice"] == wire
    assert payload["stream"] is False
    assert payload["temperature"] == 0.01
    assert payload["top_p"] == 0.95
    assert payload["frequency_penalty"] == 0.0
    assert payload["tools"][0]["function"]["name"] == TOOL_NAME
    assert payload["tools"][0]["function"]["parameters"] == SCHEMAS["strict"]
    assert record.valid is True
    assert record.reasons == ()
    assert record.latency_ms >= 0
    assert record.finish_reason == "tool_calls"
    assert record.tool_calls[0]["id"] == "tc-1"
    assert record.error is None


def test_a_streaming_cell_judges_the_reassembled_call():
    events = _sse_events()
    record = asyncio.run(
        run_cell(
            _config(),
            _transport((200, _valid_call_body())),  # unused on the streaming leg
            "served-model",
            "auto",
            "strict",
            streaming=True,
            sse_factory=lambda payload: _FakeSseStream(events),
        )
    )
    assert record.valid is True
    assert record.streaming is True
    assert record.delta_count == 3
    assert record.tool_calls[0]["arguments"] == {"query": "remote work", "max_results": 3}


def test_a_streaming_cell_payload_carries_stream_true():
    payloads: list[dict] = []
    events = _sse_events()

    def factory(payload):
        payloads.append(payload)
        return _FakeSseStream(events)

    record = asyncio.run(
        run_cell(
            _config(),
            _transport((200, _valid_call_body())),
            "served-model",
            "auto",
            "permissive",
            streaming=True,
            sse_factory=factory,
        )
    )
    assert record.valid is True
    payload = payloads[-1]
    assert payload["stream"] is True
    assert payload["tool_choice"] == "auto"
    assert payload["temperature"] == 0.01
    assert payload["top_p"] == 0.95
    assert payload["frequency_penalty"] == 0.0


def test_a_transport_failure_is_a_failed_cell_never_a_skip():
    record = asyncio.run(
        run_cell(_config(), _transport((500, "boom")), "served-model", "auto", "strict", streaming=False)
    )
    assert record.valid is None
    assert record.error is not None
    assert "answered 500" in record.error


def test_an_invalid_response_shape_is_a_failed_cell():
    transport = _transport((200, {"choices": []}))
    record = asyncio.run(run_cell(_config(), transport, "served-model", "named", "permissive", streaming=False))
    assert record.valid is None
    assert "no choice" in (record.error or "")


def test_an_unknown_tool_choice_mode_is_refused_before_any_call():
    with pytest.raises(ValueError, match="unknown tool-choice mode"):
        tool_choice_value("never")


def test_the_plain_control_records_the_wire_answer():
    transport = _transport((200, _chat_body(content="ready", finish_reason="stop")))
    control = asyncio.run(run_plain_control(_config(), transport, "served-model"))
    assert control.status_ok is True
    assert control.content_present is True
    assert control.detail is None
    payload = transport.calls[-1]["payload"]
    assert "tools" not in payload  # PLAIN: the control isolates the wire from the tool surface
    assert "tool_choice" not in payload
    assert payload["stream"] is False


def test_the_plain_control_records_a_failure_like_a_cell():
    control = asyncio.run(run_plain_control(_config(), _transport((500, "boom")), "served-model"))
    assert control.status_ok is False
    assert control.content_present is False
    assert "answered 500" in (control.detail or "")


# ---------------------------------------------------------------------
# The endpoint identity: read from the endpoint itself
# ---------------------------------------------------------------------


def test_the_identity_carries_the_version_and_model_verbatim():
    # No model-id override: the discovery probes /v1/models, and the served
    # window rides the identity with the model id.
    identity = asyncio.run(read_endpoint_identity(_config(VLLM_LLM_MODEL_ID=""), _transport((200, _valid_call_body()))))
    assert identity.generation_endpoint == ENDPOINT
    assert identity.version_raw == json.dumps({"version": "v0.29.0"})
    assert identity.model_id == "served-model"
    assert identity.max_model_len == 8192
    assert identity.served_at_utc


def test_an_absent_version_endpoint_is_recorded_not_fatal():
    transport = PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/models": (200, {"data": [{"id": "served-model"}]}),
        }
    )
    identity = asyncio.run(read_endpoint_identity(_config(), transport))
    assert identity.version_raw is None
    assert identity.version_note is not None


def test_the_model_override_means_no_discovery_call():
    transport = _transport((200, _valid_call_body()))
    asyncio.run(read_endpoint_identity(_config(), transport))
    assert [call["url"] for call in transport.calls] == [f"{ENDPOINT}/version"]


def test_a_failed_discovery_is_the_typed_transient():
    transport = PreparationFakeTransport(error=OSError("down"))
    with pytest.raises(VerificationTransientError, match="discovery failed"):
        asyncio.run(read_endpoint_identity(_config(VLLM_LLM_MODEL_ID=""), transport))


def test_the_identity_dataclass_round_trips_json():
    identity = EndpointIdentity(
        generation_endpoint=ENDPOINT,
        version_raw='{"version": "v0.29.0"}',
        version_note=None,
        model_id="served-model",
        max_model_len=8192,
        served_at_utc="2026-11-21T00:00:00+00:00",
        venue="test",
    )
    assert json.loads(json.dumps(identity.__dict__))["model_id"] == "served-model"


# ---------------------------------------------------------------------
# The matrix: the full sweep, serially, in a stable order
# ---------------------------------------------------------------------


def test_the_matrix_runs_every_cell_and_names_first_call_latency_per_schema():
    transport = _transport((200, _valid_call_body()))
    cells, first_call_latency, first_call_cell = asyncio.run(
        run_matrix(_config(), transport, "served-model", sse_factory=lambda payload: _FakeSseStream(_sse_events()))
    )
    assert len(cells) == 12
    assert [(cell.tool_choice_mode, cell.schema_strictness, cell.streaming) for cell in cells] == [
        (mode, strictness, streaming)
        for mode in ("auto", "named", "required")
        for strictness in ("strict", "permissive")
        for streaming in (False, True)
    ]
    assert set(first_call_latency) == {"strict", "permissive"}
    # The first error-free call per schema is the non-streaming cell of that
    # schema's row pair (the sweep order is mode × strictness × streaming),
    # and the record names the cell that fed each slot.
    assert first_call_latency["strict"] == cells[0].latency_ms
    assert first_call_latency["permissive"] == cells[2].latency_ms
    assert first_call_cell == {
        "strict": "auto/strict/streaming=False",
        "permissive": "auto/permissive/streaming=False",
    }


class _SequencedChatTransport:
    """``post_json`` answers a canned sequence in order, then the default."""

    def __init__(self, answers):
        self._answers = list(answers)

    async def get_json(self, url, headers, timeout_s):
        return 200, {"data": [{"id": "served-model", "max_model_len": 8192}]}

    async def post_json(self, url, headers, payload, timeout_s):
        if self._answers:
            return self._answers.pop(0)
        return 200, _valid_call_body()


def test_first_call_latency_comes_only_from_error_free_cells_and_names_its_cell():
    # A 400 rejection is not a compile observation: the errored cell never
    # feeds the slot; the first error-free cell of that schema does, and the
    # record names it.
    transport = _SequencedChatTransport([(500, "boom")])
    cells, first_call_latency, first_call_cell = asyncio.run(
        run_matrix(_config(), transport, "served-model", sse_factory=lambda payload: _FakeSseStream(_sse_events()))
    )
    assert cells[0].error is not None  # auto/strict/off errored
    assert cells[0].valid is None
    assert first_call_latency["strict"] == cells[1].latency_ms  # fed by auto/strict/on, error-free
    assert first_call_cell["strict"] == "auto/strict/streaming=True"
    assert first_call_latency["permissive"] == cells[2].latency_ms
    assert first_call_cell["permissive"] == "auto/permissive/streaming=False"


# ---------------------------------------------------------------------
# The cancellation demos
# ---------------------------------------------------------------------


class _FakeSseStream:
    """A canned stream: scripted events in order."""

    def __init__(self, events):
        self._events = events

    async def events(self):
        for event in self._events:
            yield event


def test_the_streaming_cancel_demo_records_an_aborted_midflight_read():
    # The park hands the demo the cancellation point: the consumer stops
    # after the first delta, the demo cancels there, and the read aborts
    # with the completion never delivered.
    async def scenario():
        return await demo_streaming_cancel(
            _config(),
            "served-model",
            sse_factory=lambda payload: _FakeSseStream(_sse_events()),
            first_event_wait_seconds=5.0,
        )

    observation = asyncio.run(scenario())
    assert isinstance(observation, StreamingCancelObservation)
    assert observation.deltas_received == 1
    assert observation.cancelled_error_raised is True
    assert observation.connection_aborted is True
    assert observation.completion_delivered is False


def test_the_streaming_cancel_demo_records_a_completion_delivered_before_the_cancel():
    # The honest negative control: with no park, a stream that finishes
    # before the cancel fires records exactly that — it never claims an
    # abort.
    async def scenario():
        return await demo_streaming_cancel(
            _config(),
            "served-model",
            sse_factory=lambda payload: _FakeSseStream(_sse_events()),
            first_event_wait_seconds=5.0,
            park_first_delta=False,
        )

    observation = asyncio.run(scenario())
    assert observation.completion_delivered is True
    assert observation.connection_aborted is False
    assert observation.cancelled_error_raised is False


def test_a_stream_that_never_starts_is_recorded_as_a_failed_demo():
    async def scenario():
        return await demo_streaming_cancel(
            _config(),
            "served-model",
            sse_factory=lambda payload: _FakeSseStream([]),
            first_event_wait_seconds=0.2,
        )

    observation = asyncio.run(scenario())
    assert observation.deltas_received == 0
    assert observation.error is not None
    assert "no streaming delta" in observation.error


class _HangingChatTransport:
    """``post_json`` proves dispatch, then hangs until cancelled.

    The dispatch flag flips at POST ENTRY, before the hang — so a cancel
    that reaches the recorded ``cancelled_in_post`` necessarily landed ON
    the dispatched POST, never before it. The dispatch-then-cancel ordering
    is the transport's own record, not the demo's claim.
    """

    def __init__(self):
        self.calls = []
        self.post_dispatched = False
        self.cancelled_in_post = False

    async def get_json(self, url, headers, timeout_s):
        self.calls.append({"url": url})
        return 200, {"data": [{"id": "served-model", "max_model_len": 8192}]}

    async def post_json(self, url, headers, payload, timeout_s):
        self.calls.append({"url": url})
        self.post_dispatched = True
        try:
            await asyncio.Event().wait()  # forever; the cancellation must reach HERE
        except asyncio.CancelledError:
            self.cancelled_in_post = True
            raise


def test_the_loop_cancel_demo_records_the_propagation_and_no_terminal_event():
    transport = _HangingChatTransport()
    observation = asyncio.run(demo_loop_cancel(_config(), transport, model_id="served-model"))
    assert isinstance(observation, LoopCancelObservation)
    # The dispatch-then-cancel ordering: the POST was entered (dispatch
    # recorded by the demo's recording transport AND the test transport),
    # and the cancellation landed inside that POST.
    assert observation.model_post_dispatched is True
    assert transport.post_dispatched is True
    assert transport.cancelled_in_post is True
    assert observation.cancelled_error_propagated is True
    assert observation.in_flight_model_call_cancelled is True
    assert observation.terminal_events_emitted == ()
    assert (observation.steps, observation.model_calls, observation.tool_calls) == (1, 1, 0)
    assert observation.error is None


def test_the_loop_cancel_demo_without_dispatch_never_claims_an_in_flight_cancel():
    # Discovery fails before any POST: the token fired, but no model call
    # was ever dispatched — the record must not claim an in-flight cancel.
    class _FailingDiscoveryTransport:
        async def get_json(self, url, headers, timeout_s):
            raise OSError("discovery endpoint down")

        async def post_json(self, url, headers, payload, timeout_s):
            raise AssertionError("no POST may be dispatched when discovery fails")

    observation = asyncio.run(demo_loop_cancel(_config(VLLM_LLM_MODEL_ID=""), _FailingDiscoveryTransport()))
    assert observation.model_post_dispatched is False
    assert observation.in_flight_model_call_cancelled is False
    assert observation.cancelled_error_propagated is False


# ---------------------------------------------------------------------
# The record assembly
# ---------------------------------------------------------------------


def test_the_full_record_assembles_and_round_trips_json():
    transport = _transport((200, _valid_call_body()))
    evidence = asyncio.run(
        run_verification(
            _config(),
            transport=transport,
            sse_factory=lambda payload: _FakeSseStream(_sse_events()),
            venue="unit-test",
        )
    )
    assert evidence.producer == "agent.verification"
    assert evidence.venue == "unit-test"
    assert evidence.identity.model_id == "served-model"
    assert len(evidence.cells) == 12
    assert set(evidence.first_call_latency_ms) == {"strict", "permissive"}
    assert evidence.plain_control.status_ok is True  # the wire control ran against the same fakes
    dumped = json.dumps(evidence.as_dict())
    reloaded = json.loads(dumped)
    assert reloaded["identity"]["model_id"] == "served-model"
    assert len(reloaded["cells"]) == 12


# ---------------------------------------------------------------------
# The acceptance verdict: the exit-0 semantics, judged purely
# ---------------------------------------------------------------------


def _passing_evidence() -> VerificationEvidence:
    """A record whose every gate passes — the exit-0 shape, built by hand."""
    cells = tuple(
        CellRecord(
            tool_choice_mode=mode,
            schema_strictness=strictness,
            streaming=streaming,
            valid=True,
            reasons=(),
            latency_ms=10.0,
            finish_reason="tool_calls",
            content_preview=None,
            tool_calls=({"id": "tc-1", "name": TOOL_NAME, "arguments": {"query": "q", "max_results": 3}},),
            delta_count=3,
        )
        for mode in TOOL_CHOICE_MODES
        for strictness in SCHEMA_STRICTNESS
        for streaming in (False, True)
    )
    return VerificationEvidence(
        producer="agent.verification",
        venue="test",
        captured_at_utc="2026-11-21T00:00:00+00:00",
        identity=EndpointIdentity(
            generation_endpoint=ENDPOINT,
            version_raw='{"version": "v0.29.0"}',
            version_note=None,
            model_id="served-model",
            max_model_len=8192,
            served_at_utc="2026-11-21T00:00:00+00:00",
            venue="test",
        ),
        cells=cells,
        first_call_latency_ms={"strict": 10.0, "permissive": 10.0},
        first_call_cell={"strict": "auto/strict/streaming=False", "permissive": "auto/permissive/streaming=False"},
        streaming_cancel=StreamingCancelObservation(1, True, True, False, 1.0, None),
        loop_cancel=LoopCancelObservation(True, True, True, (), 1, 1, 0, 0.1, None),
        plain_control=PlainControlObservation(True, True, None),
    )


def _with_cells(evidence: VerificationEvidence, cells: tuple[CellRecord, ...]) -> VerificationEvidence:
    return replace(evidence, cells=cells)


def _errored_cell() -> CellRecord:
    return CellRecord(
        tool_choice_mode="auto",
        schema_strictness="strict",
        streaming=False,
        valid=None,
        reasons=(),
        latency_ms=5.0,
        finish_reason=None,
        content_preview=None,
        tool_calls=(),
        delta_count=0,
        error="the endpoint answered 400: boom",
    )


def _invalid_cell() -> CellRecord:
    return CellRecord(
        tool_choice_mode="named",
        schema_strictness="permissive",
        streaming=True,
        valid=False,
        reasons=("no tool call was issued",),
        latency_ms=5.0,
        finish_reason="stop",
        content_preview="answered from memory",
        tool_calls=(),
        delta_count=2,
        error=None,
    )


def test_a_passing_record_passes_the_acceptance_verdict():
    verdict = acceptance_verdict(_passing_evidence())
    assert verdict.passed is True
    assert verdict.reasons == ()


def test_an_unresolved_identity_fails_the_verdict():
    evidence = replace(_passing_evidence(), identity=replace(_passing_evidence().identity, model_id=None))
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("identity was not resolved" in reason for reason in verdict.reasons)


def test_an_errored_cell_fails_the_verdict():
    evidence = _with_cells(_passing_evidence(), (_errored_cell(),))
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("errored" in reason and "400" in reason for reason in verdict.reasons)


def test_an_invalid_cell_fails_the_verdict():
    evidence = _with_cells(_passing_evidence(), (_invalid_cell(),))
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("invalid" in reason and "no tool call" in reason for reason in verdict.reasons)


def test_a_delivered_completion_fails_the_streaming_acceptance_shape():
    evidence = replace(
        _passing_evidence(), streaming_cancel=StreamingCancelObservation(3, False, False, True, 1.0, None)
    )
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("streaming-cancel acceptance shape" in reason for reason in verdict.reasons)


def test_a_missing_teardown_fails_the_streaming_acceptance_shape():
    # Cancelled but never torn down: the abort is inferred, not observed —
    # the acceptance shape refuses it.
    evidence = replace(
        _passing_evidence(), streaming_cancel=StreamingCancelObservation(1, True, False, False, 1.0, None)
    )
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("streaming-cancel acceptance shape" in reason for reason in verdict.reasons)


def test_an_undispatched_loop_cancel_fails_the_acceptance_shape():
    # The dispatch proof: an in-flight-cancel claim without a dispatched
    # POST is the discovery-leg shape the demo exists to exclude.
    evidence = replace(
        _passing_evidence(), loop_cancel=LoopCancelObservation(True, True, False, (), 1, 1, 0, 0.004, None)
    )
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any(
        "loop-cancel acceptance shape" in reason and "post_dispatched=False" in reason for reason in verdict.reasons
    )


def test_terminal_events_on_a_cancelled_run_fail_the_verdict():
    evidence = replace(
        _passing_evidence(), loop_cancel=LoopCancelObservation(True, True, True, ("run_error",), 1, 1, 0, 0.1, None)
    )
    verdict = acceptance_verdict(evidence)
    assert verdict.passed is False
    assert any("terminal events" in reason for reason in verdict.reasons)


# ---------------------------------------------------------------------
# The live entry: citable records, exit codes on the verdict
# ---------------------------------------------------------------------


def test_the_live_entry_exits_zero_only_on_the_full_acceptance(monkeypatch, capsys):
    import agent.verification as verification_module

    async def _run_ok(*a, **k):
        return _passing_evidence()

    monkeypatch.setattr(verification_module, "run_verification", _run_ok)
    assert verification_module._main() == 0
    record = json.loads(capsys.readouterr().out)
    assert record["acceptance"]["passed"] is True
    assert record["acceptance"]["reasons"] == []


def test_the_live_entry_exits_one_when_the_verdict_fails(monkeypatch, capsys):
    import agent.verification as verification_module

    evidence = replace(
        _passing_evidence(), streaming_cancel=StreamingCancelObservation(3, False, False, True, 1.0, None)
    )

    async def _run_fail(*a, **k):
        return evidence

    monkeypatch.setattr(verification_module, "run_verification", _run_fail)
    assert verification_module._main() == 1
    record = json.loads(capsys.readouterr().out)
    assert record["acceptance"]["passed"] is False
    assert any("streaming-cancel" in reason for reason in record["acceptance"]["reasons"])


def test_the_live_entry_prints_a_json_error_record_never_a_traceback(monkeypatch, capsys):
    import agent.verification as verification_module

    def _fail(*a, **k):
        raise VerificationTransientError("the model discovery failed: OSError: down")

    monkeypatch.setattr(verification_module, "run_verification", _fail)
    assert verification_module._main() == 1
    record = json.loads(capsys.readouterr().out)
    assert record["status"] == "failed"
    assert "the model discovery failed" in record["error"]
    assert record["producer"] == "agent.verification"


def test_parser_flag_rejections_are_summarized_in_the_notes():
    transport = _transport(
        (400, {"error": {"message": 'tool_choice="required" requires --tool-call-parser to be set'}})
    )
    evidence = asyncio.run(
        run_verification(
            _config(),
            transport=transport,
            sse_factory=lambda payload: _FakeSseStream(_sse_events()),
            venue="unit-test",
        )
    )
    assert all(cell.error is not None for cell in evidence.cells if not cell.streaming)
    assert any("rec6_serving_flags: not pinned" in note and "6 of 12" in note for note in evidence.notes)
