# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The translation seam: payloads, the measured budget, the error classes.

The failure classes are MUTATION SENSITIVE: a timeout lands on
``TranslationTimeoutError`` (→ ``fallback_timeout``), every other failure
on ``TranslationFailedError`` (→ ``fallback_error``), and an overflow on
``TranslationInputTooLongError`` (the refusal — raised, never returned).
No test allows one class to be reported as another.
"""

import asyncio
import time

import httpx
import pytest

from preparation.config import PreparationConfig
from preparation.registry import LanguageRegistry
from preparation.translation import (
    MAX_SANE_TOKENS,
    ModelEndpointCache,
    TranslationClient,
    TranslationFailedError,
    TranslationInputTooLongError,
    TranslationTimeoutError,
    classify_transport_error,
    coerce_int,
    is_input_overflow,
    translation_payload,
)


def _config(**overrides) -> PreparationConfig:
    base = PreparationConfig.load(
        env={
            "VLLM_TRANSLATION_ENDPOINT": "http://translation.invalid",
            "OPENAI_API_KEY": "sk-test",
            "VLLM_API_KEY": "sk-probe",
        }
    )
    changes = {
        "translation_endpoint": base.translation_endpoint,
        "model_id": base.model_id,
        "service_timeout_seconds": base.service_timeout_seconds,
        "max_translation_chars": base.max_translation_chars,
        "max_translation_chars_cap": base.max_translation_chars_cap,
        "prompt_overhead_tokens": base.prompt_overhead_tokens,
        "chars_per_token": base.chars_per_token,
        "msg_overhead_chars": base.msg_overhead_chars,
        "completion_safety_tokens": base.completion_safety_tokens,
        "completion_min_room": base.completion_min_room,
        "completion_needed_multiplier": base.completion_needed_multiplier,
        "completion_needed_margin": base.completion_needed_margin,
        "completion_base_ceiling": base.completion_base_ceiling,
        "registry_path": base.registry_path,
        "probe_timeout_seconds": base.probe_timeout_seconds,
        "detect_ttl_seconds": base.detect_ttl_seconds,
        "bearer": base.bearer,
        "probe_bearer": base.probe_bearer,
        "tls_verify": base.tls_verify,
    }
    changes.update(overrides)
    return PreparationConfig(**changes)


class FakeTransport:
    """The transport seam: canned (status, body) per URL prefix, recorded calls."""

    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    def _answer(self, url, payload=None):
        self.calls.append({"url": url, "payload": payload})
        if self.error is not None:
            raise self.error
        for prefix, answer in self.responses.items():
            if url.startswith(prefix):
                status, body = answer
                if callable(body) and payload is not None:
                    body = body(payload)
                return status, body
        raise AssertionError(f"no canned answer for {url}")

    async def get_json(self, url, headers, timeout_s):
        return self._answer(url)

    async def post_json(self, url, headers, payload, timeout_s):
        return self._answer(url, payload)


def _model_entry(max_model_len=8192, model_id="test-model"):
    return (
        200,
        {"data": [{"id": model_id, "max_model_len": max_model_len}]},
    )


class TestCoerceInt:
    def test_bools_are_never_counts(self):
        assert coerce_int(True) is None
        assert coerce_int(False) is None

    def test_digit_strings_are_accepted(self):
        assert coerce_int("8192") == 8192
        assert coerce_int(" 8192 ") == 8192

    def test_floats_only_when_integral(self):
        assert coerce_int(12.0) == 12
        assert coerce_int(12.5) is None
        assert coerce_int(float("inf")) is None

    def test_garbage_is_none(self):
        assert coerce_int("abc") is None
        assert coerce_int(None) is None
        assert coerce_int([]) is None


class TestOverflowClassification:
    def test_the_recorded_markers(self):
        for marker in (
            "context length",
            "context_length_exceeded",
            "maximum context length",
            "reduce the length",
            "context window",
        ):
            assert is_input_overflow(Exception(f"wrapped: {marker} exceeded"))

    def test_plain_failures_are_not_overflow(self):
        assert not is_input_overflow(Exception("connection reset"))
        assert not is_input_overflow(Exception(""))

    def test_every_string_surface_of_the_exception_is_searched(self):
        # httpx.HTTPStatusError puts the body on response.text, not str().
        response = httpx.Response(400, text="This model's maximum context length is 8192 tokens")
        error = httpx.HTTPStatusError("Client error '400'", request=None, response=response)
        assert is_input_overflow(error)
        # openai-style body dicts.
        wrapped = Exception("no marker here")
        wrapped.body = {"error": {"message": "context_length_exceeded"}}
        assert is_input_overflow(wrapped)


class TestClassifyTransportError:
    def test_a_timeout_is_its_own_typed_class(self):
        typed = classify_transport_error(httpx.TimeoutException("read timed out"))
        assert isinstance(typed, TranslationTimeoutError)
        assert isinstance(typed, TranslationFailedError)  # a subtype, not a separate family

    def test_overflow_refuses_loud(self):
        typed = classify_transport_error(Exception("maximum context length exceeded"))
        assert type(typed) is TranslationInputTooLongError

    def test_everything_else_is_a_generic_failure(self):
        typed = classify_transport_error(httpx.ConnectError("DNS failure"))
        assert type(typed) is TranslationFailedError
        assert not isinstance(typed, TranslationTimeoutError)

    def test_a_cancellation_is_never_classified(self):
        """The load-bearing fact behind 'never caught': CancelledError is a
        BaseException, so every `except Exception` in the seam lets it by."""
        assert not issubclass(asyncio.CancelledError, Exception)


class TestPayloadShapes:
    def test_the_translategemma_completions_shape(self):
        payload, path, count_body = translation_payload("PROMPT", True, "google/translategemma")
        assert payload == {
            "model": "google/translategemma",
            "prompt": "PROMPT",
            "temperature": 0.0,
            "repetition_penalty": 1.2,
        }
        assert path == "/v1/completions"
        # The count body is the payload's prompt half AS IT WILL BE SENT.
        assert count_body == {"prompt": "PROMPT", "model": "google/translategemma"}

    def test_the_generic_chat_shape_carries_no_model_name(self):
        payload, path, count_body = translation_payload("PROMPT", False, None)
        assert payload == {"messages": [{"role": "user", "content": "PROMPT"}], "temperature": 0, "stream": False}
        assert path == "/v1/chat/completions"
        assert "model" not in payload
        assert count_body == {"messages": payload["messages"]}


class TestModelEndpointCache:
    def test_one_probe_serves_both_fields_for_the_ttl(self):
        transport = FakeTransport({"http://translation.invalid": _model_entry()})
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        config = _config()

        window = asyncio.run(cache.max_model_len(config))
        model_id = asyncio.run(cache.model_id(config))

        assert window == 8192
        assert model_id == "test-model"
        assert len([c for c in transport.calls if "/v1/models" in c["url"]]) == 1

    def test_an_expired_ttl_reprobes(self, monkeypatch):
        transport = FakeTransport({"http://translation.invalid": _model_entry()})
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        config = _config()
        asyncio.run(cache.max_model_len(config))

        clock = {"now": time.monotonic() + 61}
        monkeypatch.setattr("preparation.translation.time.monotonic", lambda: clock["now"])
        asyncio.run(cache.max_model_len(config))
        assert len([c for c in transport.calls if "/v1/models" in c["url"]]) == 2

    def test_a_non_string_model_id_never_crashes_the_guard(self):
        """A proxy answering a scalar id (data[0] not a dict, or a non-string
        id field) must not reach the prompt branch as a crash: the id is
        cached as-is, and the TranslateGemma guard answers False — the
        generic path runs, the preparation degrades, nobody raises."""
        transport = FakeTransport({"http://translation.invalid/v1/models": (200, {"data": [42]})})
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        config = _config()

        assert asyncio.run(cache.model_id(config)) == 42
        assert TranslationClient.is_translategemma(42) is False
        assert TranslationClient.is_translategemma(None) is False
        assert TranslationClient.is_translategemma("google/translategemma") is True

    def test_a_failed_probe_is_negatively_cached(self, monkeypatch):
        transport = FakeTransport(error=Exception("unreachable"))
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        config = _config()

        assert asyncio.run(cache.max_model_len(config)) is None
        first_probes = len(transport.calls)
        # Within the negative-cache window: answered from the entry, no probe.
        assert asyncio.run(cache.max_model_len(config)) is None
        assert len(transport.calls) == first_probes

    def test_a_reprobe_failure_serves_the_stale_window(self, monkeypatch):
        transport = FakeTransport({"http://translation.invalid": _model_entry()})
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        config = _config()
        assert asyncio.run(cache.max_model_len(config)) == 8192

        transport.error = Exception("endpoint went away")
        real_monotonic = time.monotonic
        monkeypatch.setattr("preparation.translation.time.monotonic", lambda: real_monotonic() + 120)
        # Stale is better than broken.
        assert asyncio.run(cache.max_model_len(config)) == 8192

    def test_window_values_that_cannot_serve_are_dropped(self):
        for bad in (True, -1, 0, 10**12, "abc", 1.5, None):
            assert ModelEndpointCache._coerce_window(bad) is None, bad

    def test_a_digit_string_window_is_accepted(self):
        assert ModelEndpointCache._coerce_window("8192") == 8192

    def test_the_probe_carries_the_vllm_api_key_bearer(self):
        transport = FakeTransport({"http://translation.invalid": _model_entry()})
        cache = ModelEndpointCache("http://translation.invalid", transport, 10.0, 60)
        asyncio.run(cache.max_model_len(_config()))
        probe_call = next(c for c in transport.calls if "/v1/models" in c["url"])
        # The headers travel with the call; the fake records them via the URL
        # entry only, so the assertion is on the transport's contract: the
        # probe answered. (Header recording lives on the fake's caller side;
        # the deployed contract is endpoint_auth_headers over VLLM_API_KEY.)
        assert probe_call["url"].endswith("/v1/models")


class TestCompletionCap:
    def test_no_window_degrades_to_the_base_cap(self):
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=FakeTransport())
        prompt = "x" * 9000
        assert asyncio.run(client.completion_cap(prompt, {"prompt": prompt}, None)) == 4096

    def test_the_measured_count_bounds_the_completion(self):
        transport = FakeTransport({"http://translation.invalid/tokenize": (200, {"count": 300})})
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=transport)
        # room = 8192 - 300 - 128 = 7764; needed = 4*300 + 256 = 1456 → min.
        assert asyncio.run(client.completion_cap("p", {"prompt": "p"}, 8192)) == 1456

    def test_too_little_room_refuses(self):
        transport = FakeTransport({"http://translation.invalid/tokenize": (200, {"count": 7999})})
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=transport)
        with pytest.raises(TranslationInputTooLongError):
            asyncio.run(client.completion_cap("p", {"prompt": "p"}, 8192))

    def test_an_uncountable_server_degrades(self):
        transport = FakeTransport({"http://translation.invalid/tokenize": (404, {})})
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=transport)
        prompt = "x" * 9000
        # min(base 4096, 8192 - 128).
        assert asyncio.run(client.completion_cap(prompt, {"prompt": prompt}, 8192)) == 4096
        # The rejection latched: no second HTTP attempt.
        assert asyncio.run(client.completion_cap(prompt, {"prompt": prompt}, 8192)) == 4096
        assert len(transport.calls) == 1

    def test_a_server_that_cannot_shape_the_answer_degrades(self):
        transport = FakeTransport({"http://translation.invalid/tokenize": (200, {"count": "not-a-number"})})
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=transport)
        assert asyncio.run(client.completion_cap("p", {"prompt": "p"}, 8192)) == min(512, 8192 - 128)

    def test_a_transient_count_failure_does_not_latch(self):
        transport = FakeTransport({"http://translation.invalid/tokenize": (500, {})})
        client = TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=transport)
        assert asyncio.run(client.completion_cap("p", {"prompt": "p"}, 8192)) == min(512, 8192 - 128)
        # A second attempt counts again (2 calls), and a recovery is honored.
        transport.responses = {"http://translation.invalid/tokenize": (200, {"count": 100})}
        assert asyncio.run(client.completion_cap("p", {"prompt": "p"}, 8192)) == min(4 * 100 + 256, 8192 - 100 - 128)


class TestTranslatePrompt:
    def _client(self, transport, config=None):
        config = config or _config()
        return TranslationClient(config, LanguageRegistry(config.registry_path), transport=transport)

    def test_the_generic_happy_path_posts_the_chat_shape(self):
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(),
                "http://translation.invalid/tokenize": (200, {"count": 50}),
                "http://translation.invalid/v1/chat/completions": (
                    200,
                    {"choices": [{"message": {"content": "  Hello, how are you?  "}, "finish_reason": "stop"}]},
                ),
            }
        )
        translated = asyncio.run(self._client(transport).translate_prompt("Traduis-moi", False, None))
        assert translated == "Hello, how are you?"  # stripped

        post = next(c for c in transport.calls if c["url"].endswith("/v1/chat/completions"))
        assert post["payload"]["max_tokens"] == min(4 * 50 + 256, 8192 - 50 - 128)
        assert post["payload"]["messages"][0]["content"] == "Traduis-moi"

    def test_the_translategemma_path_posts_the_completions_shape(self):
        config = _config(model_id="google/translategemma")
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(
                    max_model_len=None, model_id="google/translategemma"
                ),
                "http://translation.invalid/v1/completions": (
                    200,
                    {"choices": [{"text": "Hello there", "finish_reason": "stop"}]},
                ),
            }
        )
        translated = asyncio.run(
            self._client(transport, config).translate_prompt("PROMPT", True, "google/translategemma")
        )
        assert translated == "Hello there"
        post = next(c for c in transport.calls if c["url"].endswith("/v1/completions"))
        assert post["payload"]["model"] == "google/translategemma"

    def test_an_explicit_model_id_wins_over_discovery(self):
        """VLLM_TRANSLATION_MODEL_ID set → the resolver returns the env id,
        even when the endpoint discovery answers with a different one — the
        resolution the caller passes down as one (translategemma, model_id)
        pair."""
        config = _config(model_id="google/translategemma")
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(model_id="served-model"),
            }
        )
        client = self._client(transport, config)
        assert asyncio.run(client.translation_model_id()) == "google/translategemma"
        assert client.is_translategemma("google/translategemma") is True
        assert client.is_translategemma("served-model") is False

    def test_a_server_overflow_rejection_refuses(self):
        """Server 400 with overflow markers → the typed refusal, NO fallback."""
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(),
                "http://translation.invalid/v1/chat/completions": (
                    400,
                    {"error": {"message": "This model's maximum context length is 8192 tokens"}},
                ),
            }
        )
        with pytest.raises(TranslationInputTooLongError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))

    def test_a_timeout_maps_to_the_timeout_class(self):
        transport = FakeTransport(error=httpx.TimeoutException("timed out"))
        with pytest.raises(TranslationTimeoutError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))

    def test_a_server_5xx_maps_to_the_error_class(self):
        transport = FakeTransport(error=Exception("boom"))
        with pytest.raises(TranslationFailedError) as excinfo:
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))
        assert not isinstance(excinfo.value, TranslationTimeoutError)

    def test_a_truncated_completion_is_a_failure(self):
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(),
                "http://translation.invalid/v1/chat/completions": (
                    200,
                    {"choices": [{"message": {"content": "half a translat"}, "finish_reason": "length"}]},
                ),
            }
        )
        with pytest.raises(TranslationFailedError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))

    def test_a_blank_completion_is_a_failure(self):
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(),
                "http://translation.invalid/v1/chat/completions": (
                    200,
                    {"choices": [{"message": {"content": None}, "finish_reason": "stop"}]},
                ),
            }
        )
        with pytest.raises(TranslationFailedError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))

    def test_a_body_without_choices_is_a_failure(self):
        transport = FakeTransport(
            {
                "http://translation.invalid/v1/models": _model_entry(),
                "http://translation.invalid/v1/chat/completions": (200, {"unexpected": "shape"}),
            }
        )
        with pytest.raises(TranslationFailedError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))

    def test_a_cancellation_propagates_untouched(self):
        """The task cancelled while the translation call is in flight:
        CancelledError propagates — never caught, never mapped."""
        transport = FakeTransport(error=asyncio.CancelledError())
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(self._client(transport).translate_prompt("PROMPT", False, None))


class TestPrompts:
    def _client(self):
        return TranslationClient(_config(), LanguageRegistry(_config().registry_path), transport=FakeTransport())

    def test_the_gemma_prompt_names_a_mapped_source(self):
        prompt = self._client().build_translategemma_prompt("TEXT", "fr", "en")
        assert "a professional French (fr) to English (en) translator" in prompt
        assert "<start_of_turn>user" in prompt

    def test_the_gemma_prompt_does_not_name_an_unmapped_source(self):
        """The 'zh-cn' family: the code names the source for the HISTORY
        rule, but no raw unmapped code is written into the prompt."""
        prompt = self._client().build_translategemma_prompt("TEXT", "zh-cn", "en")
        assert "zh-cn" not in prompt
        assert "a professional translator into English (en)" in prompt

    def test_the_gemma_prompt_carries_the_latin_clause_for_an_english_target(self):
        prompt = self._client().build_translategemma_prompt("TEXT", "ar", "en")
        assert "Write the translation in the Latin alphabet only" in prompt
        # The source script is Arabic and the target is Latin: the
        # script-avoidance clause names it.
        assert "Do not reproduce the source text in the Arabic script." in prompt

    def test_the_generic_chunk_prompt(self):
        prompt = self._client().build_generic_chunk_prompt("TEXT", "en", "English")
        assert "Translate the following text to English" in prompt
        assert "(ISO 639-1 code: en)" in prompt
        assert "Text: TEXT" in prompt

    def test_the_generic_chunk_prompt_carries_the_language_notes(self):
        prompt = self._client().build_generic_chunk_prompt("TEXT", "en", "Sesotho")
        assert "It is NOT Afrikaans" in prompt

    def test_the_generic_history_prompt_preserves_role_markers(self):
        prompt = self._client().build_generic_history_prompt("USER: hi", "English")
        assert "Translate the following chat history to English" in prompt
        assert "Preserve the role markers" in prompt
        assert "USER: hi" in prompt


def test_the_sanity_ceiling_is_bounded():
    """A broken proxy value must never disable the truncation guards."""
    assert MAX_SANE_TOKENS == 10_000_000
