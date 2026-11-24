# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The model-endpoint config: the venue's own TLS and credential conventions.

The self-signed GPU gateway answers 401 without the deployment's bearer and
dies on httpx's verifying default — the venue's own knobs
(``OPEA_SSL_SKIP_VERIFY``, ``OPENAI_API_KEY``/``VLLM_API_KEY``) are the
convention every other client of that gateway reads (issue #2167; the
search capability's first live run exposed both)."""

from capabilities.adapters.env_config import ModelEndpointConfig


def test_tls_verify_defaults_on_and_reads_the_venue_skip_knob():
    assert ModelEndpointConfig.load({}).tls_verify is True
    assert ModelEndpointConfig.load({"OPEA_SSL_SKIP_VERIFY": "1"}).tls_verify is False
    assert ModelEndpointConfig.load({"OPEA_SSL_SKIP_VERIFY": "0"}).tls_verify is True


def test_bearer_prefers_openai_key_then_vllm_key_then_empty():
    both = ModelEndpointConfig.load({"OPENAI_API_KEY": "a", "VLLM_API_KEY": "b"})
    assert both.bearer == "a"
    vllm_only = ModelEndpointConfig.load({"VLLM_API_KEY": "b"})
    assert vllm_only.bearer == "b"
    assert ModelEndpointConfig.load({}).bearer == ""
