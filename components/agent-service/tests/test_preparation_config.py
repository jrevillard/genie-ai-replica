# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The frozen env-knob surface of the preparation module.

Every knob the deployed preparation pipeline reads is asserted here under
its deployed NAME with its deployed CODE DEFAULT — a deployment that tunes
the legacy path must tune this module identically, so a renamed knob or a
drifted default turns these red.
"""

import dataclasses
from pathlib import Path

from preparation.config import DEFAULT_REGISTRY_PATH, PreparationConfig


def test_code_defaults_match_the_deployed_module():
    """Empty env → every knob at its deployed code default."""
    config = PreparationConfig.load(env={})

    # The compose-internal translation service when no direct vLLM endpoint
    # is named (deployed TRANSLATION_SERVICE_HOST_IP/PORT defaults).
    assert config.translation_endpoint == "http://0.0.0.0:80"
    assert config.model_id == ""
    assert config.service_timeout_seconds == 180
    assert config.max_translation_chars == 2000
    assert config.max_translation_chars_cap == 0
    assert config.prompt_overhead_tokens == 512
    assert config.chars_per_token == 3
    assert config.msg_overhead_chars == 20
    assert config.completion_safety_tokens == 128
    assert config.completion_min_room == 256
    assert config.completion_needed_multiplier == 4
    assert config.completion_needed_margin == 256
    assert config.completion_base_ceiling == 4096
    assert config.probe_timeout_seconds == 10.0
    assert config.detect_ttl_seconds == 60
    assert config.bearer is None
    assert config.probe_bearer is None
    assert config.tls_verify is True


def test_the_registry_path_defaults_to_the_vendored_copy():
    config = PreparationConfig.load(env={})
    assert config.registry_path == DEFAULT_REGISTRY_PATH
    assert config.registry_path.endswith("preparation/language-registry.json")
    assert Path(config.registry_path).is_file()


def test_a_direct_vllm_endpoint_wins_over_the_compose_service(monkeypatch):
    """VLLM_TRANSLATION_ENDPOINT set → direct vLLM for translation AND discovery."""
    env = {
        "TRANSLATION_SERVICE_HOST_IP": "translation",
        "TRANSLATION_SERVICE_PORT": "8000",
        "VLLM_TRANSLATION_ENDPOINT": "https://gpu-node:444/translation",
    }
    assert PreparationConfig.load(env=env).translation_endpoint == "https://gpu-node:444/translation"
    # Unset → the compose-internal service built from the host/port knobs.
    compose_only = {k: v for k, v in env.items() if k != "VLLM_TRANSLATION_ENDPOINT"}
    assert PreparationConfig.load(env=compose_only).translation_endpoint == "http://translation:8000"


def test_deployed_env_names_set_their_knobs():
    env = {
        "VLLM_TRANSLATION_MODEL_ID": "google/translategemma",
        "TRANSLATION_SERVICE_TIMEOUT": "90",
        "MAX_TRANSLATION_CHARS": "5000",
        "LANGUAGE_REGISTRY_FILEPATH": "/opt/registry.json",
        "MODEL_PROBE_TIMEOUT_SECONDS": "5.5",
        "MODEL_DETECT_TTL": "30",
        "OPENAI_API_KEY": "sk-data",
        "VLLM_API_KEY": "sk-probe",
        "OPEA_SSL_SKIP_VERIFY": "1",
    }
    config = PreparationConfig.load(env=env)

    assert config.model_id == "google/translategemma"
    assert config.service_timeout_seconds == 90
    # MAX_TRANSLATION_CHARS both IS the fallback and CAPS the derivation —
    # the two roles the deployed module reads it in.
    assert config.max_translation_chars == 5000
    assert config.max_translation_chars_cap == 5000
    assert config.registry_path == "/opt/registry.json"
    assert config.probe_timeout_seconds == 5.5
    assert config.detect_ttl_seconds == 30
    assert config.bearer == "sk-data"
    assert config.probe_bearer == "sk-probe"
    # The self-signed-GPU-cert escape hatch flips TLS verification off.
    assert config.tls_verify is False


def test_an_unset_max_translation_chars_caps_nothing():
    """The DEFAULT (env unset) must not lower the derived budget: the venue's
    derived budget was 11520, not 2000 (V02 §5.3)."""
    config = PreparationConfig.load(env={})
    assert config.max_translation_chars_cap == 0


def test_set_to_empty_and_garbage_numeric_envs_fall_back_to_defaults():
    """Set-to-empty (compose's default injection) and non-numeric values
    fall back to the code default instead of crash-looping the wiring
    (deployed _env_int semantics)."""
    env = {
        "TRANSLATION_SERVICE_TIMEOUT": "",
        "MAX_TRANSLATION_CHARS": "   ",
        "MODEL_PROBE_TIMEOUT_SECONDS": "abc",
        "MODEL_DETECT_TTL": "not-a-number",
    }
    config = PreparationConfig.load(env=env)

    assert config.service_timeout_seconds == 180
    assert config.max_translation_chars == 2000
    # The empty knob is "not set by the deployer": it caps nothing.
    assert config.max_translation_chars_cap == 0
    assert config.probe_timeout_seconds == 10.0
    assert config.detect_ttl_seconds == 60


def test_a_set_to_empty_registry_path_is_honored_as_deployed():
    """The registry path is a PATH knob, not a semantic knob: set-to-empty
    is honored as the broken path it is (deployed parity) — the reader
    reports it unreadable instead of silently repairing it to the vendored
    default."""
    config = PreparationConfig.load(env={"LANGUAGE_REGISTRY_FILEPATH": ""})
    assert config.registry_path == ""


def test_the_config_is_frozen():
    config = PreparationConfig.load(env={})
    try:
        config.service_timeout_seconds = 1
    except dataclasses.FrozenInstanceError:
        pass
    else:
        raise AssertionError("PreparationConfig must be frozen: a mutable config lets one caller retune the module")
