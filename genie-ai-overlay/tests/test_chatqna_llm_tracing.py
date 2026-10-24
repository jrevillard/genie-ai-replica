# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the llm.invoke span emitted at the chatqna orchestrator boundary.

The span is what makes an LLM call legible: which model answered, which sampling
params were actually sent, how many tokens it consumed, and why it stopped. It is
emitted here rather than in the textgen wrapper because the wrapper cannot see
params dropped in transit -- the exact failure this span exists to catch.

`start_as_current_span` returns a context manager, NOT a Span; opening with it
and calling set_attribute raises AttributeError. The helpers therefore use
`start_span` with the current context, which returns a real Span whose lifetime
the streaming path controls.

The emission sites are driven for real (`TestWiring*` below), not only the
helpers: a suite that exercises only the helpers leaves the whole file green if
someone deletes the `span.set_attribute` calls in `align_outputs` /
`align_generator`.
"""

import contextlib
import json
from enum import Enum
from unittest.mock import MagicMock, patch

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A


class FakeServiceType(Enum):
    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"


def _sync_response():
    return {
        "model": "ibm-granite/granite-4.1-8b",
        "choices": [{"index": 0, "message": {"content": "hi"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280},
    }


def _chunks(with_usage=True):
    out = [
        {
            "model": "ibm-granite/granite-4.1-8b",
            "choices": [{"index": 0, "delta": {"content": "hel"}, "finish_reason": None}],
        },
        {
            "model": "ibm-granite/granite-4.1-8b",
            "choices": [{"index": 0, "delta": {"content": "lo"}, "finish_reason": "stop"}],
        },
    ]
    if with_usage:
        out.append(
            {
                "model": "ibm-granite/granite-4.1-8b",
                "choices": [],
                "usage": {
                    "prompt_tokens": 1200,
                    "completion_tokens": 2,
                    "total_tokens": 1202,
                },
            }
        )
    return out


def _llm_service_node(endpoint="http://textgen:6009/v1/chat/completions"):
    node = MagicMock()
    node.service_type = FakeServiceType.LLM
    node.endpoint = endpoint
    return node


def _orchestrator():
    self_mock = MagicMock()
    self_mock.services = {"textgen.1": _llm_service_node()}
    return self_mock


class TestLlmInvokeSync:
    def test_records_model_usage_and_finish_reason(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open(
            {"max_tokens": 512, "top_p": 0.9, "temperature": 0.2, "stream": False}
        )
        chatqna_module._emit_llm_invoke_record(span, _sync_response())
        chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_model"]] == "ibm-granite/granite-4.1-8b"
        assert emitted.attributes[A["llm_usage_prompt_tokens"]] == 1200
        assert emitted.attributes[A["llm_usage_completion_tokens"]] == 80
        assert emitted.attributes[A["llm_usage_total_tokens"]] == 1280
        assert emitted.attributes[A["llm_finish_reason"]] == "stop"
        assert emitted.attributes[A["llm_stream"]] is False

    def test_records_only_params_present_in_the_request(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 512, "top_p": 0.9, "stream": False})
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_req_max_tokens"]] == 512
        assert attrs[A["llm_req_top_p"]] == 0.9
        assert A["llm_req_repetition_penalty"] not in attrs
        assert A["llm_req_temperature"] not in attrs

    def test_missing_usage_is_omitted_not_nulled(self, captured_spans):
        response = _sync_response()
        del response["usage"]
        span = chatqna_module._emit_llm_invoke_open({"stream": False})
        chatqna_module._emit_llm_invoke_record(span, response)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert A["llm_usage_prompt_tokens"] not in attrs
        assert A["llm_usage_completion_tokens"] not in attrs

    def test_finish_reason_length_is_recorded_verbatim(self, captured_spans):
        response = _sync_response()
        response["choices"][0]["finish_reason"] = "length"
        span = chatqna_module._emit_llm_invoke_open({"stream": False})
        chatqna_module._emit_llm_invoke_record(span, response)
        chatqna_module._emit_llm_invoke_close(span)

        assert captured_spans("llm.invoke")[0].attributes[A["llm_finish_reason"]] == "length"

    def test_stream_flag_has_one_source_of_truth(self, captured_spans):
        """llm.stream and llm.stream_options.include_usage cannot disagree."""
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 8, "stream": True})
        chatqna_module._emit_llm_invoke_close(span)
        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_stream"]] is True
        assert attrs[A["llm_stream_options_include_usage"]] is True

        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 8, "stream": False})
        chatqna_module._emit_llm_invoke_close(span)
        attrs = captured_spans("llm.invoke")[1].attributes
        assert attrs[A["llm_stream"]] is False
        assert A["llm_stream_options_include_usage"] not in attrs

    def test_span_is_parented_to_the_current_context(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as parent:
            parent_id = parent.get_span_context().span_id
            span = chatqna_module._emit_llm_invoke_open({"stream": False})
            chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.parent.span_id == parent_id
        assert emitted.context.trace_id == parent.get_span_context().trace_id

    def test_query_id_rides_along_from_baggage(self, captured_spans):
        from opentelemetry import baggage

        token = baggage.set_baggage(A["query_id"], "queries:12345")
        from opentelemetry.context import attach

        ctx = attach(token)
        try:
            span = chatqna_module._emit_llm_invoke_open({"stream": False})
            chatqna_module._emit_llm_invoke_close(span)
        finally:
            from opentelemetry.context import detach

            detach(ctx)

        assert captured_spans("llm.invoke")[0].attributes[A["query_id"]] == "queries:12345"

    def test_no_query_id_means_omitted(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": False})
        chatqna_module._emit_llm_invoke_close(span)

        assert A["query_id"] not in captured_spans("llm.invoke")[0].attributes


class TestLlmInvokeStreaming:
    def test_streaming_usage_is_present_and_non_null(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 256, "stream": True})
        for chunk in _chunks(with_usage=True):
            chatqna_module._emit_llm_invoke_record(span, chunk)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_usage_prompt_tokens"]] == 1200
        assert attrs[A["llm_usage_completion_tokens"]] == 2
        assert attrs[A["llm_finish_reason"]] == "stop"

    def test_streaming_without_usage_omits_the_attributes(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        for chunk in _chunks(with_usage=False):
            chatqna_module._emit_llm_invoke_record(span, chunk)
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert A["llm_usage_prompt_tokens"] not in attrs
        assert attrs[A["llm_finish_reason"]] == "stop"

    def test_last_finish_reason_wins(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        chatqna_module._emit_llm_invoke_record(span, {"choices": [{"delta": {"content": "a"}, "finish_reason": None}]})
        chatqna_module._emit_llm_invoke_record(
            span, {"choices": [{"delta": {"content": "b"}, "finish_reason": "length"}]}
        )
        chatqna_module._emit_llm_invoke_close(span)

        assert captured_spans("llm.invoke")[0].attributes[A["llm_finish_reason"]] == "length"

    def test_non_dict_chunk_does_not_raise(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open({"stream": True})
        chatqna_module._emit_llm_invoke_record(span, None)
        chatqna_module._emit_llm_invoke_record(span, "not a dict")
        chatqna_module._emit_llm_invoke_close(span)

        assert len(captured_spans("llm.invoke")) == 1


class TestLlmInvokePrivacy:
    def test_no_free_text_on_the_llm_span(self, captured_spans):
        from core.span_attrs import assert_no_free_text

        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 512, "temperature": 0.2, "stream": False})
        chatqna_module._emit_llm_invoke_record(span, _sync_response())
        chatqna_module._emit_llm_invoke_close(span)

        (emitted,) = captured_spans("llm.invoke")
        assert_no_free_text(dict(emitted.attributes))


# ===========================================================================
# Wiring — drive the real emission sites, not just the helpers
# ===========================================================================
class TestAlignOutputsWiring:
    def test_align_outputs_records_the_llm_span(self, captured_spans):
        """Deleting the emission site from align_outputs must turn this red."""
        self_mock = _orchestrator()
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = chatqna_module.align_outputs(
                self_mock,
                _sync_response(),
                "textgen.1",
                {},
                MagicMock(),
                {"max_tokens": 512, "temperature": 0.2, "stream": False},
            )

        assert result["text"] == "hi"
        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_model"]] == "ibm-granite/granite-4.1-8b"
        assert emitted.attributes[A["llm_usage_prompt_tokens"]] == 1200
        assert emitted.attributes[A["llm_usage_total_tokens"]] == 1280
        assert emitted.attributes[A["llm_finish_reason"]] == "stop"
        assert emitted.attributes[A["llm_req_max_tokens"]] == 512
        assert emitted.attributes[A["llm_stream"]] is False
        assert emitted.attributes[A["llm_service_path"]] == "/v1/chat/completions"

    def test_align_outputs_leaves_no_span_open_when_extraction_raises(self, captured_spans):
        """A malformed response must still close the span, not leak it."""
        self_mock = _orchestrator()
        broken = {"model": "ibm-granite/granite-4.1-8b", "choices": [], "usage": {"prompt_tokens": 5}}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType), contextlib.suppress(IndexError):
            chatqna_module.align_outputs(self_mock, broken, "textgen.1", {}, MagicMock(), {"stream": False})

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_usage_prompt_tokens"]] == 5

    def test_align_outputs_skips_the_span_for_streaming(self, captured_spans):
        """Streaming goes through align_generator; emitting here too would double-count."""
        self_mock = _orchestrator()
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            chatqna_module.align_outputs(self_mock, _sync_response(), "textgen.1", {}, MagicMock(), {"stream": True})

        assert captured_spans("llm.invoke") == []


class TestAlignGeneratorWiring:
    def test_align_generator_records_the_llm_span(self, captured_spans):
        """Deleting the emission site from align_generator must turn this red."""
        params = {"max_tokens": 256, "stream": True}
        lines = []
        for chunk in _chunks(with_usage=True):
            lines.append(("data:" + json.dumps(chunk) + "\n\n").encode("utf-8"))

        out = list(chatqna_module.align_generator(None, gen=iter(lines), llm_parameters_dict=params))

        assert out[-1] == "data: [DONE]\n\n"
        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_stream"]] is True
        assert emitted.attributes[A["llm_stream_options_include_usage"]] is True
        # The usage-only terminal frame is recorded (above) and then skipped:
        # the skip leaves an event so a swallowed frame stays diagnosable.
        event_names = [event.name for event in emitted.events]
        assert "chatqna.stream.frame_skipped" in event_names
        assert emitted.attributes[A["llm_req_max_tokens"]] == 256
        assert emitted.attributes[A["llm_usage_prompt_tokens"]] == 1200
        assert emitted.attributes[A["llm_usage_completion_tokens"]] == 2
        assert emitted.attributes[A["llm_finish_reason"]] == "stop"

    def test_align_generator_omits_params_it_was_not_given(self, captured_spans):
        """What the call site knows is recorded; what it does not know is omitted.

        ``align_generator`` IS the streaming branch, so ``llm.stream`` is true
        whether or not comps forwarded ``llm_parameters_dict`` -- asserting
        ``False`` here pinned the confident-wrong reading of an absent dict.
        ``llm.stream_options.include_usage`` is the opposite case: whether the
        request asked for usage alongside the stream is unknown without the
        dict, so it is omitted rather than guessed.
        """
        lines = [(b'data:{"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n')]
        list(chatqna_module.align_generator(None, gen=iter(lines)))

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_stream"]] is True
        assert A["llm_req_max_tokens"] not in emitted.attributes
        assert A["llm_stream_options_include_usage"] not in emitted.attributes

    def test_align_generator_closes_the_span_when_upstream_raises(self, captured_spans):
        def _boom():
            yield b'data:{"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\n\n'
            raise RuntimeError("upstream died")

        gen = chatqna_module.align_generator(None, gen=_boom(), llm_parameters_dict={"stream": True})
        try:
            next(gen)
            next(gen)
        except RuntimeError:
            pass

        (emitted,) = captured_spans("llm.invoke")
        assert emitted.attributes[A["llm_stream"]] is True

    def test_align_generator_closes_the_span_when_abandoned(self, captured_spans):
        gen = chatqna_module.align_generator(
            None,
            gen=iter([b'data:{"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\n\n']),
            llm_parameters_dict={"stream": True},
        )
        next(gen)
        gen.close()

        assert len(captured_spans("llm.invoke")) == 1


class TestAlignInputsWiring:
    """The request params on chatqna.orchestrate are read from the wire body."""

    def _run(self, llm_params, inputs):
        self_mock = _orchestrator()
        tokenizer = MagicMock()
        tokenizer.encode = lambda text: []
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.get_tokenizer", return_value=tokenizer),
        ):
            return chatqna_module.align_inputs(
                self_mock,
                inputs,
                "textgen.1",
                MagicMock(),
                llm_params,
            )

    def test_request_params_land_on_the_enclosing_orchestrate_span(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate"):
            result = self._run(
                {"max_tokens": 512, "top_p": 0.9, "temperature": 0.2, "stream": True},
                {"inputs": "rag prompt", "stream": True, "frequency_penalty": 0.3, "temperature": 0.7},
            )

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        # max_tokens / top_p are written from llm_parameters_dict...
        assert orchestrate.attributes[A["llm_req_max_tokens"]] == 512
        assert orchestrate.attributes[A["llm_req_top_p"]] == 0.9
        # ...and agree with the body.
        assert orchestrate.attributes[A["llm_req_temperature"]] == result["temperature"]
        assert orchestrate.attributes[A["llm_req_frequency_penalty"]] == result["frequency_penalty"]

    def test_span_reports_the_wire_body_not_the_parameters_dict(self, captured_spans):
        """Degenerate case: the two sources deliberately disagree.

        ``align_inputs`` writes temperature and frequency_penalty into the body
        from ``inputs``, NOT from ``llm_parameters_dict``. A span that read the
        latter would report values vLLM never receives — reproducing, on the
        very span built to expose it, the "params silently altered before vLLM"
        blind spot this issue is about.
        """
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate"):
            result = self._run(
                {"max_tokens": 512, "top_p": 0.9, "temperature": 0.2, "frequency_penalty": 0.1, "stream": True},
                {"inputs": "rag prompt", "stream": True, "frequency_penalty": 0.9, "temperature": 0.7},
            )

        # Prove the two sources really do differ on this run.
        assert result["temperature"] == 0.7
        assert result["frequency_penalty"] == 0.9

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        assert orchestrate.attributes[A["llm_req_temperature"]] == 0.7
        assert orchestrate.attributes[A["llm_req_frequency_penalty"]] == 0.9

    def test_repetition_penalty_is_not_recorded_because_it_is_never_sent(self, captured_spans):
        """A parameter chatqna does not put in the body must not be advertised.

        ``repetition_penalty`` is real vLLM vocabulary, but align_inputs never
        writes it -- so recording it would name a parameter vLLM never received.
        """
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate"):
            result = self._run(
                {"max_tokens": 512, "top_p": 0.9, "temperature": 0.2, "repetition_penalty": 1.1, "stream": True},
                {"inputs": "rag prompt", "stream": True, "frequency_penalty": 0.0, "temperature": 0.7},
            )

        assert "repetition_penalty" not in result
        (orchestrate,) = captured_spans("chatqna.orchestrate")
        assert A["llm_req_repetition_penalty"] not in orchestrate.attributes

    def test_repetition_penalty_is_not_recorded_on_llm_invoke_either(self, captured_spans):
        """The llm.invoke hooks read llm_parameters_dict, which is where the lie would survive.

        Those two align hooks have no request body in scope, so a mapping entry
        for a parameter chatqna never sends would advertise it there even though
        the orchestrate span correctly omits it.
        """
        span = chatqna_module._emit_llm_invoke_open({"max_tokens": 512, "repetition_penalty": 1.1, "stream": False})
        chatqna_module._emit_llm_invoke_close(span)

        assert A["llm_req_repetition_penalty"] not in captured_spans("llm.invoke")[0].attributes

    def test_every_recorded_param_is_one_align_inputs_actually_sends(self):
        """Guards the whole mapping against advertising a parameter chatqna drops.

        Asserts against the body ``align_inputs`` builds rather than against a
        copy of the list, so adding a mapping entry without a matching
        ``next_inputs`` write fails here.
        """
        import inspect

        source = inspect.getsource(chatqna_module.align_inputs)
        for key, _attr in chatqna_module._LLM_REQUEST_PARAM_ATTRS:
            assert f'next_inputs["{key}"]' in source, f"{key} is recorded but never sent"

    def test_streaming_request_asks_for_usage(self):
        result = self._run(
            {"max_tokens": 512, "top_p": 0.9, "stream": True},
            {"inputs": "rag prompt", "stream": True, "frequency_penalty": 0.0, "temperature": 0.7},
        )

        assert result["stream_options"] == {"include_usage": True}

    def test_sync_request_does_not_send_stream_options(self):
        result = self._run(
            {"max_tokens": 512, "top_p": 0.9, "stream": False},
            {"inputs": "rag prompt", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7},
        )

        assert "stream_options" not in result

    def test_stream_options_is_gated_on_llm_parameters_dict_not_inputs(self):
        """stream_options follows llm_parameters_dict; the body's stream follows inputs.

        A mismatch produces a request that streams without asking for usage, so
        the streaming llm.invoke span omits token attributes. That state is
        recorded rather than papered over: pinning which gate wins is the point,
        not asserting the two can never differ.
        """
        result = self._run(
            {"max_tokens": 512, "top_p": 0.9, "stream": False},
            {"inputs": "rag prompt", "stream": True, "frequency_penalty": 0.0, "temperature": 0.7},
        )

        assert result["stream"] is True
        assert "stream_options" not in result


class TestLlmRequestParamNormalisation:
    def test_pydantic_style_params_are_accepted(self, captured_spans):
        class Params:
            def model_dump(self):
                return {"max_tokens": 64, "stream": True}

        span = chatqna_module._emit_llm_invoke_open(Params())
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_req_max_tokens"]] == 64
        assert attrs[A["llm_stream"]] is True

    def test_unusable_params_omit_rather_than_raise(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open(object())
        chatqna_module._emit_llm_invoke_close(span)

        attrs = captured_spans("llm.invoke")[0].attributes
        assert attrs[A["llm_stream"]] is False
        assert A["llm_req_max_tokens"] not in attrs

    def test_none_params_open_a_span_with_stream_false(self, captured_spans):
        span = chatqna_module._emit_llm_invoke_open(None)
        chatqna_module._emit_llm_invoke_close(span)

        assert captured_spans("llm.invoke")[0].attributes[A["llm_stream"]] is False
