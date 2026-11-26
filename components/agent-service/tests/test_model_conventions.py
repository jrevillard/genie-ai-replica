# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The model port's shared conventions — the request shape every consumer sends.

The port module (``capabilities/model.py``) is the ONE home of the
OpenAI-compatible conventions this component speaks: the recorded sampling
params, the URL shape, the bearer header and the body. Every consumer of the
endpoint builds its request through these helpers, so a change to the recorded
convention lands once.

Each test pins ONE convention, and each pins it in a way that can FAIL:
a test that cannot redden proves nothing.
"""

from capabilities.model import (
    RECORDED_SAMPLING_PARAMS,
    chat_auth_headers,
    chat_completions_url,
    chat_payload,
)

MESSAGES = [{"role": "user", "content": "the question"}]


def test_the_payload_carries_the_recorded_sampling_params():
    """The recorded request-level params — one home, every consumer."""

    payload = chat_payload("served-model", MESSAGES)

    assert payload["temperature"] == 0.01
    assert payload["top_p"] == 0.95
    assert payload["frequency_penalty"] == 0.0
    assert payload["stream"] is False
    # The params are the RECORDED ones, read from the single source — a
    # helper that inlined its own copy would drift from them silently.
    assert {key: payload[key] for key in RECORDED_SAMPLING_PARAMS} == RECORDED_SAMPLING_PARAMS


def test_the_payload_carries_the_model_and_the_messages():
    """The two fields the endpoint cannot default."""

    payload = chat_payload("served-model", MESSAGES)

    assert payload["model"] == "served-model"
    assert payload["messages"] == MESSAGES


def test_the_payload_carries_the_callers_own_fields():
    """The per-consumer fields (the toolset, the answer bound) ride on top."""

    payload = chat_payload("served-model", MESSAGES, tools=[{"type": "function"}], max_tokens=512)

    assert payload["tools"] == [{"type": "function"}]
    assert payload["max_tokens"] == 512


def test_the_url_is_the_chat_completions_path_of_the_endpoint():
    """The URL shape: the endpoint's, plus the chat/completions path."""

    assert chat_completions_url("http://llm.invalid") == "http://llm.invalid/v1/chat/completions"


def test_the_url_keeps_the_endpoint_verbatim():
    """The endpoint is concatenated, not normalized.

    A trailing slash is the DEPLOYMENT's business: rewriting it here would
    silently change the URL a recorded endpoint answers on.
    """

    assert chat_completions_url("http://llm.invalid/") == "http://llm.invalid//v1/chat/completions"


def test_the_headers_carry_the_bearer_when_there_is_one():
    """The bearer per call, never on a session (deployed: same server, same auth)."""

    assert chat_auth_headers("the-key") == {"Authorization": "Bearer the-key"}


def test_the_headers_are_empty_when_there_is_no_bearer():
    """No key, no header."""

    assert chat_auth_headers(None) == {}
    assert chat_auth_headers("") == {}
