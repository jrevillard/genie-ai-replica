# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The fixed generation stage (story 1.9).

Mutation-sensitive pins: the recorded payload params ride every request
(temperature 0.01, top_p 0.95, frequency_penalty 0.0, stream false,
max_tokens omitted unless configured), the model id resolves override-first
then discovery, the window answers in the deployed three tiers, and every
failure shape is the typed transient — never a fabricated answer.
"""

import asyncio
import dataclasses

import pytest
from conftest import PreparationFakeTransport
from conftest import preparation_model_entry as _model_entry

from noagent.config import NoAgentConfig
from noagent.generation import (
    GenerationClient,
    GenerationTransientError,
    TokenCounter,
    generation_payload,
)

ENDPOINT = "http://llm.invalid"


def _config(**overrides) -> NoAgentConfig:
    base = NoAgentConfig.load(env={"VLLM_LLM_ENDPOINT": ENDPOINT})
    return dataclasses.replace(base, **overrides)


def _chat_transport(content="The answer.", finish_reason="stop", status=200, model_id="served-model", window=8192):
    return PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/models": _model_entry(max_model_len=window, model_id=model_id),
            f"{ENDPOINT}/v1/chat/completions": (
                status,
                {"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]},
            ),
        }
    )


def _client(config=None, transport=None) -> GenerationClient:
    config = config or _config()
    return GenerationClient.create(config, transport=transport or _chat_transport())


# ---------------------------------------------------------------------
# The recorded payload
# ---------------------------------------------------------------------


def test_payload_carries_the_recorded_params_and_omits_max_tokens():
    payload = generation_payload("sys", "user", "served-model", None)
    assert payload["temperature"] == 0.01
    assert payload["top_p"] == 0.95
    assert payload["frequency_penalty"] == 0.0
    assert payload["stream"] is False
    assert "max_tokens" not in payload  # omitted — the server default answers
    assert payload["model"] == "served-model"
    assert payload["messages"] == [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "user"},
    ]


def test_payload_carries_max_tokens_only_when_configured():
    payload = generation_payload("sys", "user", "m", 512)
    assert payload["max_tokens"] == 512


def test_generate_sends_the_recorded_body_and_returns_the_content():
    transport = _chat_transport(content="Grounded answer.")
    client = _client(transport=transport)
    answer = asyncio.run(client.generate("sys prompt", "user content"))
    assert answer == "Grounded answer."
    call = transport.calls[-1]
    assert call["url"] == f"{ENDPOINT}/v1/chat/completions"
    assert call["payload"]["temperature"] == 0.01
    assert call["payload"]["top_p"] == 0.95
    assert call["payload"]["frequency_penalty"] == 0.0
    assert call["payload"]["stream"] is False
    assert "max_tokens" not in call["payload"]


def test_generate_carries_the_bearer_when_configured():
    transport = _chat_transport()
    config = _config(bearer="sk-data")
    asyncio.run(GenerationClient.create(config, transport=transport).generate("s", "u"))
    assert transport.calls[-1]["headers"] == {"Authorization": "Bearer sk-data"}


# ---------------------------------------------------------------------
# The model id and the window: the deployed resolution tiers
# ---------------------------------------------------------------------


def test_model_id_override_wins_over_discovery():
    transport = _chat_transport(model_id="served-model")
    config = _config(model_id_override="deployer-pinned")
    client = GenerationClient.create(config, transport=transport)
    assert asyncio.run(client.model_id()) == "deployer-pinned"
    # The override means no probe is even needed.
    assert transport.calls == []


def test_model_id_is_discovered_from_the_endpoint_when_unset():
    transport = _chat_transport(model_id="served-model")
    client = GenerationClient.create(_config(), transport=transport)
    assert asyncio.run(client.model_id()) == "served-model"


def test_window_answers_in_the_deployed_three_tiers():
    # Tier 1: an explicit consumer-side cap wins, no probe.
    transport = _chat_transport(window=4096)
    config = _config(window_override_tokens=2048)
    assert asyncio.run(GenerationClient.create(config, transport=transport).window_tokens()) == 2048
    assert transport.calls == []
    # Tier 2: the probed max_model_len.
    transport = _chat_transport(window=4096)
    assert asyncio.run(GenerationClient.create(_config(), transport=transport).window_tokens()) == 4096
    # Tier 3: the code default when discovery has no answer.
    transport = PreparationFakeTransport({f"{ENDPOINT}/v1/models": (500, {"error": "down"})})
    assert asyncio.run(GenerationClient.create(_config(), transport=transport).window_tokens()) == 65536


def test_discovery_is_ttl_cached_and_the_window_negative_cached():
    """One probe per TTL window on the happy path; on an outage the WINDOW
    field keeps its negative cache (one probe per window) while the model id
    keeps retrying — the shared cache's recorded stance (deployed: the
    model-id getter fails loudly when nothing answers)."""
    transport = _chat_transport()
    client = GenerationClient.create(_config(), transport=transport)
    asyncio.run(client.model_id())
    asyncio.run(client.model_id())
    assert len(transport.calls) == 1  # TTL hit
    transport_down = PreparationFakeTransport({f"{ENDPOINT}/v1/models": (500, {"error": "down"})})
    down_client = GenerationClient.create(_config(), transport=transport_down)
    assert asyncio.run(down_client.window_tokens()) == 65536  # the tier-3 fallback
    assert asyncio.run(down_client.window_tokens()) == 65536
    assert len(transport_down.calls) == 1  # negative cache hit for the window field


# ---------------------------------------------------------------------
# Typed failures — never a fabricated answer
# ---------------------------------------------------------------------


def test_transport_failure_is_typed_transient():
    transport = PreparationFakeTransport(error=RuntimeError("connection refused"))
    client = _client(transport=transport)
    with pytest.raises(GenerationTransientError, match="the generation call failed"):
        asyncio.run(client.generate("s", "u"))


def test_non_2xx_status_is_typed_transient():
    transport = _chat_transport(status=503)
    client = _client(transport=transport)
    with pytest.raises(GenerationTransientError, match="503"):
        asyncio.run(client.generate("s", "u"))


def test_missing_choice_or_content_is_typed_transient():
    empty = PreparationFakeTransport(
        {f"{ENDPOINT}/v1/chat/completions": (200, {"choices": []})},
    )
    with pytest.raises(GenerationTransientError, match="no choice"):
        asyncio.run(_client(transport=empty).generate("s", "u"))
    no_text = PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/chat/completions": (
                200,
                {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]},
            )
        },
    )
    with pytest.raises(GenerationTransientError, match="no text content"):
        asyncio.run(_client(transport=no_text).generate("s", "u"))


def test_a_cut_off_completion_is_a_failure_never_a_short_answer():
    transport = _chat_transport(content="partial", finish_reason="length")
    with pytest.raises(GenerationTransientError, match="cut off"):
        asyncio.run(_client(transport=transport).generate("s", "u"))


def test_cancellation_propagates_untouched():
    class CancelledTransport:
        async def post_json(self, url, headers, payload, timeout_s):
            await asyncio.sleep(10)

    client = _client(transport=CancelledTransport())

    async def scenario():
        task = asyncio.ensure_future(client.generate("s", "u"))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return "cancelled"
        return "completed"

    assert asyncio.run(scenario()) == "cancelled"


# ---------------------------------------------------------------------
# The token counter
# ---------------------------------------------------------------------


def test_counter_reads_the_server_count_and_carries_the_probe_bearer():
    transport = PreparationFakeTransport(
        {
            f"{ENDPOINT}/v1/models": _model_entry(model_id="served-model"),
            f"{ENDPOINT}/tokenize": (200, {"count": 42}),
        }
    )
    config = _config(probe_bearer="vk-probe")
    counter = TokenCounter(config, _client(config, transport).model_id, transport)
    assert asyncio.run(counter.count("some text")) == 42
    call = transport.calls[-1]
    assert call["url"] == f"{ENDPOINT}/tokenize"
    assert call["headers"] == {"Authorization": "Bearer vk-probe"}
    assert call["payload"] == {"model": "served-model", "prompt": "some text"}


def test_counter_prefers_the_count_and_falls_back_to_the_token_list():
    async def model_id():  # the getter the pipeline injects is async
        return "m"

    transport = PreparationFakeTransport({f"{ENDPOINT}/tokenize": (200, {"tokens": ["a", "b", "c"]})})
    counter = TokenCounter(_config(), model_id, transport)
    assert asyncio.run(counter.count("x")) == 3


def test_counter_failures_are_loud_never_a_guess():
    async def model_id():
        return "m"

    transport = PreparationFakeTransport({f"{ENDPOINT}/tokenize": (200, {"garbage": True})})
    counter = TokenCounter(_config(), model_id, transport)
    with pytest.raises(GenerationTransientError, match="neither a count nor a token list"):
        asyncio.run(counter.count("x"))
    down = PreparationFakeTransport(error=RuntimeError("endpoint down"))
    counter = TokenCounter(_config(), model_id, down)
    with pytest.raises(GenerationTransientError, match="token count failed"):
        asyncio.run(counter.count("x"))
