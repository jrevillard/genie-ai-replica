# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""The chatqna.stream_outcome span: the answer-level outcome of a streamed turn.

A span of its own, not an attribute on chatqna.orchestrate, because the
streaming body is iterated by the framework AFTER the orchestrate span has ended
-- an attribute written to that span by then is dropped without error.

EXPLICITLY PARENTED, not merely current. By the time Starlette iterates the body
the active context belongs to the request task, not to the RAG trace: a span
opened with no ``context=`` starts a NEW trace, and the outcome would sit in a
trace of its own instead of beside the retrieval and reranking spans an operator
is reading. Every assertion below that matters checks the parentage, because a
span carrying the right attributes on the wrong trace still hides the turn.
"""

import ast
import functools
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.responses import StreamingResponse
from opentelemetry import trace as otel_trace

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import assert_no_free_text
from tests.test_chatqna import (
    _fake_parms,
    _patched_chat_request,
    create_chatqna_service,
    create_mock_chat_request_data,
    create_mock_request,
)

CHATQNA_SOURCE = Path(chatqna_module.__file__)

STREAM_OUTCOME = "chatqna.stream_outcome"
ORCHESTRATE = "chatqna.orchestrate"


def _create_service():
    """A ChatQnAService built without __init__ (which would dial the megaservice)."""
    svc = chatqna_module.ChatQnAService.__new__(chatqna_module.ChatQnAService)
    svc.host = "0.0.0.0"
    svc.port = 8888
    svc.megaservice = MagicMock()
    svc.endpoint = "/v1/chatqna"
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})
    return svc


async def _body(chunks):
    for chunk in chunks:
        yield chunk


async def _drain(gen):
    return [item async for item in gen]


class TestStreamOutcomeSpan:
    def test_records_the_answer_level_outcome(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.72,
            self_confidence=0.81,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )
        (span,) = captured_spans(STREAM_OUTCOME)
        assert span.attributes[A["retrieval_confidence"]] == 0.72
        assert span.attributes[A["llm_self_confidence"]] == 0.81
        assert span.attributes[A["answer_is_grounded"]] is True
        assert span.attributes[A["answer_sentinel_present"]] is True
        assert span.attributes[A["answer_abstained"]] is False

    def test_missing_self_confidence_is_omitted_not_nulled(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.5,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=False,
        )
        (span,) = captured_spans(STREAM_OUTCOME)
        assert A["llm_self_confidence"] not in span.attributes
        assert span.attributes[A["retrieval_confidence"]] == 0.5

    def test_abstention_is_recorded(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.0,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=True,
        )
        assert captured_spans(STREAM_OUTCOME)[0].attributes[A["answer_abstained"]] is True

    def test_joins_the_rag_trace_rather_than_starting_a_new_one(self, captured_spans):
        """The whole point: the outcome must land in the RAG trace."""
        tracer = chatqna_module.get_tracer(ORCHESTRATE)
        with tracer.start_as_current_span(ORCHESTRATE) as orchestrate:
            expected_parent = orchestrate.get_span_context().span_id
            expected_trace = orchestrate.get_span_context().trace_id
            # Captured here, emitted after the block closed -- the same shape the
            # production path has when Starlette iterates the body.
            parent_context = otel_trace.set_span_in_context(orchestrate)

        chatqna_module._emit_stream_outcome_span(
            parent_context=parent_context,
            retrieval_confidence=0.5,
            self_confidence=None,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )

        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.parent.span_id == expected_parent
        assert outcome.context.trace_id == expected_trace

    def test_without_a_parent_it_is_still_emitted(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.1,
            self_confidence=None,
            is_grounded=False,
            sentinel_present=False,
            abstained=False,
        )
        assert len(captured_spans(STREAM_OUTCOME)) == 1

    def test_privacy(self, captured_spans):
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.72,
            self_confidence=0.81,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )
        assert_no_free_text(dict(captured_spans(STREAM_OUTCOME)[0].attributes))

    def test_the_span_is_swept_for_attribute_leaks(self, span_sweep, captured_spans):
        """Owned by the conftest sweep, so an unregistered attribute fails here."""
        chatqna_module._emit_stream_outcome_span(
            parent_context=None,
            retrieval_confidence=0.5,
            self_confidence=None,
            is_grounded=True,
            sentinel_present=True,
            abstained=False,
        )
        span_sweep(captured_spans())


class TestStreamWithMetadataWiring:
    """Drives the real generator: the outcome must be emitted from the stream,
    parented on the orchestrate context the caller captured."""

    @pytest.mark.asyncio
    async def test_outcome_span_joins_the_orchestrate_trace(self, captured_spans):
        svc = _create_service()
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.95, True))

        tracer = chatqna_module.get_tracer(ORCHESTRATE)
        with tracer.start_as_current_span(ORCHESTRATE) as orchestrate:
            expected_parent = orchestrate.get_span_context().span_id
            expected_trace = orchestrate.get_span_context().trace_id
            parent_context = otel_trace.set_span_in_context(orchestrate)

        body = _body(["data: b'Hello'\n\n", "data: [DONE]\n\n"])
        await _drain(svc._stream_with_metadata(body, {}, token="t", parent_context=parent_context))

        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.parent.span_id == expected_parent
        assert outcome.context.trace_id == expected_trace
        assert outcome.attributes[A["retrieval_confidence"]] == 0.95
        assert outcome.attributes[A["answer_is_grounded"]] is True
        assert outcome.attributes[A["answer_abstained"]] is False

    @pytest.mark.asyncio
    async def test_self_grade_sentinel_sets_both_attributes(self, captured_spans, monkeypatch):
        """A parsed sentinel is the only thing that makes sentinel_present true."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = _create_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.4, False))

        body = _body(["data: b'Answer [[CONF:77]]'\n\n", "data: [DONE]\n\n"])
        await _drain(svc._stream_with_metadata(body, {}, token="t"))

        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.attributes[A["answer_sentinel_present"]] is True
        assert outcome.attributes[A["llm_self_confidence"]] == 0.77

    @pytest.mark.asyncio
    async def test_a_missing_sentinel_is_reported_as_absent_not_false_scored(self, captured_spans, monkeypatch):
        """Self-grade requested but never completed: absent, not zero."""
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = _create_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.4, False))

        body = _body(["data: b'Answer'\n\n", "data: [DONE]\n\n"])
        await _drain(svc._stream_with_metadata(body, {}, token="t"))

        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.attributes[A["answer_sentinel_present"]] is False
        assert A["llm_self_confidence"] not in outcome.attributes

    @pytest.mark.asyncio
    async def test_one_span_per_stream_not_one_per_chunk(self, captured_spans):
        """A span per token would drown the trace; the outcome is per turn."""
        svc = _create_service()
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.4, False))

        body = _body([f"data: b'token{i}'\n\n" for i in range(25)] + ["data: [DONE]\n\n"])
        await _drain(svc._stream_with_metadata(body, {}, token="t"))

        assert len(captured_spans(STREAM_OUTCOME)) == 1


class TestHandleRequestWiring:
    """End to end: the real handle_request builds the StreamingResponse that the
    real generator later drives, and the outcome must still sit in the RAG trace
    after the orchestrate span has closed. This is the failure the gap exists to
    prevent, so it is asserted end to end rather than by construction."""

    @pytest.mark.asyncio
    async def test_streamed_turn_joins_the_orchestrate_trace(self, captured_spans, monkeypatch):
        monkeypatch.setattr(chatqna_module, "LLM_SELF_CONFIDENCE_ENABLED", True)
        svc = _create_service()

        async def _body():
            yield "data: b'Answer [[CONF:64]]'\n\n"
            yield "data: [DONE]\n\n"

        llm_response = StreamingResponse(_body(), media_type="text/event-stream")

        async def _schedule(*_args, **_kwargs):
            return {"llm-vllm": llm_response}, None

        svc.megaservice.schedule = _schedule
        svc._assemble_source_documents = AsyncMock(return_value=([{"document_id": "f1"}], 0.6, True))

        request = MagicMock()
        request.headers = {"Authorization": "Bearer dummy.jwt.token"}
        request.json = AsyncMock(return_value={"messages": [{"role": "user", "content": "what is X?"}], "stream": True})

        chat_request = MagicMock(
            stream=True,
            context=None,
            language=None,
            messages=[{"role": "user", "content": "what is X?"}],
        )
        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
            patch.object(chatqna_module.ChatCompletionRequest, "model_validate", return_value=chat_request),
        ):
            response = await svc.handle_request(request)
            assert isinstance(response, StreamingResponse)
            await _drain(response.body_iterator)

        (orchestrate,) = captured_spans(ORCHESTRATE)
        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.parent.span_id == orchestrate.context.span_id
        assert outcome.context.trace_id == orchestrate.context.trace_id
        assert outcome.attributes[A["retrieval_confidence"]] == 0.6
        assert outcome.attributes[A["answer_is_grounded"]] is True
        assert outcome.attributes[A["llm_self_confidence"]] == 0.64


class TestAbstentionPathRecordsTheOutcome:
    """An abstained turn must be recorded, not silently missing.

    The outcome span used to be emitted by the ANSWER stream alone. The
    reranker-abstention branch returns its own ``_abstention_stream()`` and never
    reaches that generator, so every existing span said ``abstained=false`` and a
    dashboard computing ``count(abstained==true) / count(abstained)`` read
    0/0 -- indistinguishable from "the system never abstains".
    """

    def _abstaining_service(self):
        svc = create_chatqna_service()
        svc.user_profile_client = MagicMock()
        svc.user_profile_client.get_user_profile = AsyncMock(return_value={})

        async def _raise_marker(*_args, **_kwargs):
            raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

        svc.megaservice.schedule = _raise_marker
        return svc

    async def _run(self, stream: bool):
        svc = self._abstaining_service()
        req = create_mock_request(
            data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
            headers={"Authorization": "Bearer dummy.jwt.token"},
        )
        with (
            patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
            patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
            patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
            _patched_chat_request(stream=stream),
        ):
            return await svc.handle_request(req)

    @pytest.mark.asyncio
    async def test_a_streamed_abstention_emits_the_outcome_span(self, captured_spans):
        response = await self._run(stream=True)
        assert isinstance(response, StreamingResponse)
        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.attributes[A["answer_abstained"]] is True
        assert outcome.attributes[A["answer_is_grounded"]] is False
        assert outcome.attributes[A["retrieval_confidence"]] == 0.0
        assert A["llm_self_confidence"] not in outcome.attributes

    @pytest.mark.asyncio
    async def test_the_abstention_span_joins_the_rag_trace(self, captured_spans):
        response = await self._run(stream=True)
        await _drain(response.body_iterator)
        (orchestrate,) = captured_spans(ORCHESTRATE)
        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert outcome.parent.span_id == orchestrate.context.span_id
        assert outcome.context.trace_id == orchestrate.context.trace_id

    @pytest.mark.asyncio
    async def test_the_span_agrees_with_the_payload_the_caller_receives(self, captured_spans):
        """The span and the SSE metadata are two views of one event."""
        response = await self._run(stream=True)
        events = [item async for item in response.body_iterator]
        payloads = [json.loads(e[len("data: ") :]) for e in events if isinstance(e, str) and e.startswith("data: {")]
        (outcome,) = captured_spans(STREAM_OUTCOME)
        assert payloads[0]["abstained"] == outcome.attributes[A["answer_abstained"]]
        assert payloads[0]["is_grounded"] == outcome.attributes[A["answer_is_grounded"]]
        assert payloads[0]["retrieval_confidence_score"] == outcome.attributes[A["retrieval_confidence"]]

    @pytest.mark.asyncio
    async def test_absence_of_the_span_now_means_only_not_streamed(self, captured_spans):
        """The property the change buys, stated as a test: a non-streamed
        abstention emits no span, so span presence means "a streamed turn"."""
        await self._run(stream=False)
        assert list(captured_spans(STREAM_OUTCOME)) == []

    @pytest.mark.asyncio
    async def test_exactly_one_outcome_span_per_abstained_turn(self, captured_spans):
        await self._run(stream=True)
        assert len(captured_spans(STREAM_OUTCOME)) == 1

    def test_the_abstention_branch_emits_the_span(self):
        """Source-level guard: the emission is not commented out or dropped by
        a later refactor while the behaviour test still passes by accident."""
        calls = [
            node
            for node in ast.walk(_function_node("handle_request"))
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_emit_stream_outcome_span"
        ]
        assert len(calls) == 1, "the abstention branch must record the outcome exactly once"

    @pytest.mark.asyncio
    async def test_privacy(self, captured_spans):
        await self._run(stream=True)
        assert_no_free_text(dict(captured_spans(STREAM_OUTCOME)[0].attributes))


class _FakeParms:
    """Stand-in for the Genieai*Parms classes handle_request builds."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


@functools.cache
def _function_node(name: str) -> ast.AST:
    tree = ast.parse(CHATQNA_SOURCE.read_text())
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    )


def _calls_to(function_name: str, callee: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(_function_node(function_name))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == callee
    ]


class TestEmissionSiteArguments:
    """Pins the source of each value. The right attribute carrying the wrong
    value is the drift this gap exists to catch, and a hand-built-span test
    cannot see it."""

    def test_the_generator_emits_exactly_once(self):
        calls = _calls_to("_stream_with_metadata", "_emit_stream_outcome_span")
        assert len(calls) == 1, "_stream_with_metadata must record the outcome exactly once per stream"

    def test_the_span_is_parented_on_the_captured_orchestrate_context(self):
        call = _calls_to("_stream_with_metadata", "_emit_stream_outcome_span")[0]
        parent = next((kw.value for kw in call.keywords if kw.arg == "parent_context"), None)
        assert parent is not None and ast.unparse(parent) == "parent_context", (
            "the outcome span must be parented on the context handle_request "
            f"passed in, got {parent and ast.unparse(parent)} — omitting it makes "
            "the span start a new trace of its own."
        )

    def test_the_values_are_the_measured_ones_not_constants(self):
        call = _calls_to("_stream_with_metadata", "_emit_stream_outcome_span")[0]
        rendered = {kw.arg: ast.unparse(kw.value) for kw in call.keywords}
        assert rendered["retrieval_confidence"] == "retrieval_confidence"
        assert rendered["self_confidence"] == "self_confidence"
        assert rendered["is_grounded"] == "is_grounded"
        # `abstained` was the constant False for as long as nothing measured
        # it. The retrieval decides it now — any expression but a constant is
        # acceptable, so a rename or a hoist never trips this guard while a
        # revert to a constant always does. The retrieval-derived semantics
        # are pinned by the runtime tests in test_chatqna.py.
        span_arg = next(kw.value for kw in call.keywords if kw.arg == "abstained")
        assert not isinstance(span_arg, ast.Constant), (
            "the outcome span's abstained must be measured, not a constant — a "
            "scope that matched nothing has to show up in the trace"
        )

    def test_handle_request_captures_the_orchestrate_context_inside_the_with_block(self):
        """Captured after the block closes it would hold a stale/None handle."""
        orchestrate = _function_node("handle_request")
        captures = [
            node
            for node in ast.walk(orchestrate)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "set_span_in_context"
            and any(isinstance(a, ast.Name) and a.id == "span" for a in node.args)
        ]
        assert len(captures) == 1, "handle_request must capture the orchestrate context exactly once"
