# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The no-agent config: the frozen env-knob surface (story 1.9).

Deployed names keep deployed defaults; new knobs follow the component's
conventions and answer their documented defaults when unset.
"""

import dataclasses

import pytest

from noagent.config import DEFAULT_MAX_ANSWER_TOKENS, NoAgentConfig
from noagent.prompt import DEFAULT_ABSTENTION_INSTRUCTIONS, DEFAULT_SYSTEM_PROMPT


def test_unset_env_answers_the_documented_defaults():
    config = NoAgentConfig.load(env={})
    # Deployed compose fallback for the generation endpoint.
    assert config.generation_endpoint == "http://0.0.0.0:80"
    assert config.model_id_override == ""
    assert config.llm_timeout_seconds == 180.0  # MODEL_LLM_TIMEOUT_SECONDS
    assert config.system_prompt_override == ""
    assert config.abstention_instructions_override == ""
    assert config.enforce_abstention is True  # CHATQNA_ENFORCE_ABSTENTION default true
    assert config.answer_tokens == 0  # omitted — the server default answers
    assert config.fallback_window_tokens == 65536  # MAX_MODEL_LEN_TEXTGEN default
    assert config.answer_translation_enabled is False  # the gate is OFF by default
    assert config.translation_timeout_seconds == 180  # TRANSLATION_SERVICE_TIMEOUT
    assert config.lane_slots == 1
    assert config.lane_lock_path == "/tmp/agent-service-lane.lock"
    assert config.confidence_rank_decay == 0.5  # CONFIDENCE_RANK_DECAY


def test_deployed_endpoint_rule_remote_beats_compose_knob_beats_internal():
    remote = NoAgentConfig.load(env={"VLLM_LLM_ENDPOINT": "https://gpu.invalid/llm"})
    assert remote.generation_endpoint == "https://gpu.invalid/llm"
    compose = NoAgentConfig.load(env={"VLLM_ENDPOINT": "http://vllm:8000"})
    assert compose.generation_endpoint == "http://vllm:8000"
    internal = NoAgentConfig.load(env={"LLM_SERVER_HOST_IP": "vllm", "LLM_SERVER_PORT": "8000"})
    assert internal.generation_endpoint == "http://vllm:8000"
    # The remote name wins when both are set (the deployed override order).
    both = NoAgentConfig.load(env={"VLLM_LLM_ENDPOINT": "https://gpu.invalid/llm", "VLLM_ENDPOINT": "http://vllm:8000"})
    assert both.generation_endpoint == "https://gpu.invalid/llm"


def test_set_to_empty_knobs_fall_back_to_defaults():
    # The compose default injection for semantic knobs is the empty string.
    config = NoAgentConfig.load(
        env={"MODEL_LLM_TIMEOUT_SECONDS": "", "AGENT_LANE_SLOTS": "", "CONFIDENCE_RANK_DECAY": ""}
    )
    assert config.llm_timeout_seconds == 180.0
    assert config.lane_slots == 1
    assert config.confidence_rank_decay == 0.5


def test_lane_slots_floor_is_one_even_when_misconfigured():
    config = NoAgentConfig.load(env={"AGENT_LANE_SLOTS": "0"})
    assert config.lane_slots == 1
    config = NoAgentConfig.load(env={"AGENT_LANE_SLOTS": "-4"})
    assert config.lane_slots == 1
    config = NoAgentConfig.load(env={"AGENT_LANE_SLOTS": "6"})
    assert config.lane_slots == 6


def test_answer_translation_gate_and_endpoint():
    config = NoAgentConfig.load(env={"AGENT_ANSWER_TRANSLATION_ENABLED": "true"})
    assert config.answer_translation_enabled is True
    # The endpoint follows the deployed remote-vs-compose rule.
    remote = NoAgentConfig.load(
        env={"AGENT_ANSWER_TRANSLATION_ENABLED": "1", "VLLM_TRANSLATION_ENDPOINT": "https://gpu.invalid/translation"}
    )
    assert remote.translation_endpoint == "https://gpu.invalid/translation"
    internal = NoAgentConfig.load(
        env={"TRANSLATION_SERVICE_HOST_IP": "translation", "TRANSLATION_SERVICE_PORT": "9031"}
    )
    assert internal.translation_endpoint == "http://translation:9031"


def test_enforce_abstention_predicate_is_the_deployed_exact_match():
    """Deployed `_abstention_enforced`: the lower-cased value must be exactly
    "true" — any other value (including "0" and garbage) leaves the
    guardrail OFF, and unset keeps it on (the deployed default)."""
    assert NoAgentConfig.load(env={}).enforce_abstention is True
    assert NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "false"}).enforce_abstention is False
    assert NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "True"}).enforce_abstention is True
    assert NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "TRUE"}).enforce_abstention is True
    assert NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "0"}).enforce_abstention is False
    assert NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "garbage"}).enforce_abstention is False


def test_prompt_overrides_ride_the_config_verbatim():
    config = NoAgentConfig.load(
        env={"CHATQNA_SYSTEM_PROMPT": "  Custom system.  ", "CHATQNA_ABSTENTION_INSTRUCTIONS": "  Custom abstain.  "}
    )
    assert config.system_prompt_override == "Custom system."  # stripped, as deployed
    assert config.abstention_instructions_override == "Custom abstain."
    # Unset → the module's defaults are the deployed text (the pipeline reads
    # them through prompt.py; the config carries only the override).
    assert NoAgentConfig.load(env={}).system_prompt_override == ""


def test_bearers_are_the_deployed_split():
    config = NoAgentConfig.load(env={"OPENAI_API_KEY": "sk-data", "VLLM_API_KEY": "vk-probe"})
    assert config.bearer == "sk-data"  # the data calls
    assert config.probe_bearer == "vk-probe"  # the /v1/models + /tokenize probes


def test_data_bearer_falls_back_to_the_gpu_node_key():
    """The data-call bearer reads the probe client's selection rule
    (``OPENAI_API_KEY or VLLM_API_KEY``): the canonical venue carries only
    the GPU-node key, and an in-process run inherits the operator's shell —
    not the compose mapping that fills OPENAI_API_KEY from VLLM_API_KEY
    (#2065). An explicit OPENAI_API_KEY still wins."""
    fallback = NoAgentConfig.load(env={"VLLM_API_KEY": "vk-probe"})
    assert fallback.bearer == "vk-probe"
    assert fallback.probe_bearer == "vk-probe"
    assert NoAgentConfig.load(env={}).bearer is None


def test_answer_reserve_uses_the_deployed_default():
    """The guard plans against 3896 when no max_tokens is configured, and
    against the configured one when it is — the generation request itself
    carries max_tokens only when configured."""
    from noagent.prompt import answer_reserve

    assert answer_reserve(NoAgentConfig.load(env={})) == DEFAULT_MAX_ANSWER_TOKENS == 3896
    configured = NoAgentConfig.load(env={"AGENT_ANSWER_MAX_TOKENS": "512"})
    assert answer_reserve(configured) == 512


def test_config_is_frozen():
    config = NoAgentConfig.load(env={})
    with pytest.raises(dataclasses.FrozenInstanceError):
        config.lane_slots = 5  # must raise


def test_defaults_carry_the_deployed_prompt_texts():
    """The defaults the pipeline falls back to are the deployed module's own
    strings — the byte-identity is the equivalence suite's business; this
    pin only refuses an accidental empty default."""
    assert DEFAULT_SYSTEM_PROMPT.startswith("You are a friendly and polite information assistant.")
    assert DEFAULT_ABSTENTION_INSTRUCTIONS.startswith("\n[No Relevant Documents Found]")
