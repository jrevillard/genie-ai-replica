# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The frozen env-knob surface of the no-agent pipeline (config B).

Deployed knobs keep their deployed names and defaults, so a deployment that
tunes the deployed chat path tunes this pipeline identically:

* the generation endpoint follows the deployed remote-vs-compose rule —
  ``VLLM_LLM_ENDPOINT`` set (the remote GPU node) → that base URL is used
  directly; unset → ``VLLM_ENDPOINT`` (the compose knob this repo ships) →
  else the compose-internal vLLM at ``http://{LLM_SERVER_HOST_IP}:{LLM_SERVER_PORT}``
  (deployed chatqna names, deployed defaults);
* the model id is discovered from ``{endpoint}/v1/models`` with the
  ``VLLM_LLM_MODEL_ID`` override (the deployed two-tier resolution);
* the prompt overrides (``CHATQNA_SYSTEM_PROMPT``,
  ``CHATQNA_ABSTENTION_INSTRUCTIONS``, ``CHATQNA_ENFORCE_ABSTENTION``) carry
  the deployed defaults verbatim.

New knobs follow the component's conventions: the model-call budget reads
the shared ``MODEL_LLM_TIMEOUT_SECONDS`` (180 s), the lane reads
``AGENT_LANE_*``
and the answer-translation gate reads ``AGENT_ANSWER_TRANSLATION_ENABLED``
(default OFF — the answer language stays BFF-owned in deployment; the gate
exists for the evaluation mode to turn on deliberately).
"""

import logging
import math
import os
from dataclasses import dataclass

from capabilities.model import VllmModelConfig
from preparation.config import _env_float, _env_int

logger = logging.getLogger(__name__)


def _env_bool(source, name: str, default: str) -> bool:
    """The deployed boolean read (``os.getenv(...) or default`` + lower-case
    compare; set-to-empty falls back to the default).

    Only the literal ``true`` enables the knob. This is the DEPLOYED
    predicate of the abstention guardrail, and it stays an exact match:
    widening it would enable a guardrail where the deployed service leaves it
    off.
    """
    raw = source.get(name)
    return str(raw if raw not in (None, "") else default).lower() == "true"


def _env_flag(source, name: str, default: str) -> bool:
    """The feature-flag read: the repository's ``0``/``1`` convention.

    ``1`` and ``true`` enable, ``0`` and ``false`` disable, and any other
    value falls back to the default with a warning naming the knob — a
    malformed flag is a configuration defect, and the operator must see it
    instead of finding the gate silently off.
    """
    raw = source.get(name)
    value = str(raw if raw not in (None, "") else default).strip().lower()
    if value in ("1", "true"):
        return True
    if value in ("0", "false"):
        return False
    logger.warning(
        "%s=%r is not a flag value (expected 0 or 1): the default %r applies",
        name,
        raw,
        default,
    )
    return str(default).strip().lower() in ("1", "true")


# Two knob-reading disciplines live in this module, side by side:
#
# * the TOLERANT readers above (``_env_int`` / ``_env_float`` / ``_env_bool``
#   / ``_env_flag``) fall back to a default — a deployed semantic knob that is
#   unset or empty must not crash-loop a long-running service at wiring time;
# * the REQUIRED readers below fall back to NOTHING — a budget number the
#   enforcement path needs is fail-closed: unset, empty, non-numeric,
#   non-finite or out-of-bound means the caller refuses, naming the knob.
# The next consumer imports instead of copying.


def required_positive_int(source, name: str, failed: list[str]) -> int | None:
    """Read one REQUIRED integer knob; name it in ``failed`` when unset,
    empty, non-numeric or below 1 — a knob that fails its bound is as
    unusable as a knob that is absent."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        failed.append(name)
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        failed.append(name)
        return None
    if value < 1:
        failed.append(name)
        return None
    return value


def required_positive_float(source, name: str, failed: list[str]) -> float | None:
    """The float twin of :func:`required_positive_int` (strictly > 0 and
    finite — a nan would silently disable the dimension it bounds, since
    every comparison against it is False)."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        failed.append(name)
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        failed.append(name)
        return None
    if not math.isfinite(value) or value <= 0:
        failed.append(name)
        return None
    return value


# The answer-token reserve when the request configures none (deployed
# chatqna code constant: DEFAULT_MAX_ANSWER_TOKENS). Kept independent of the
# discovered window: a big window must not invite unbounded generations — it
# only widens the history budget.
DEFAULT_MAX_ANSWER_TOKENS = 3896

# The context-budget guard's fixed buffer (deployed: "Leave buffer" − 200):
# it absorbs the ±1 boundary tokens a per-piece token count would merge.
WINDOW_BUFFER_TOKENS = 200


@dataclass(frozen=True)
class NoAgentConfig:
    """Every number and name the no-agent pipeline runs under."""

    # --- generation (deployed names) ---
    generation_endpoint: str
    model_id_override: str
    llm_timeout_seconds: float
    system_prompt_override: str
    abstention_instructions_override: str
    enforce_abstention: bool
    # The explicit answer reserve (deployed ``max_tokens`` request field);
    # 0 = omitted — the generation call carries no max_tokens and the
    # truncation guard reserves DEFAULT_MAX_ANSWER_TOKENS.
    answer_tokens: int
    # The fallback window when discovery has no answer (deployed
    # MAX_MODEL_LEN_TEXTGEN code default 65536).
    fallback_window_tokens: int
    # An explicit consumer-side window cap (deployed MAX_MODEL_LEN_TEXTGEN):
    # >0 wins over discovery, exactly as deployed.
    window_override_tokens: int
    bearer: str | None
    probe_bearer: str | None
    tls_verify: bool
    probe_timeout_seconds: float
    detect_ttl_seconds: int

    # --- answer translation (gated OFF by default) ---
    answer_translation_enabled: bool
    translation_endpoint: str
    translation_model_id: str
    translation_timeout_seconds: int

    # --- admission lane ---
    lane_slots: int
    lane_lock_path: str

    # --- metadata confidence ---
    # The rank-decay of the confidence average (deployed
    # CONFIDENCE_RANK_DECAY, default 0.5).
    confidence_rank_decay: float

    @classmethod
    def load(cls, env=None) -> "NoAgentConfig":
        """Read the knobs from the environment; ``env`` defaults to ``os.environ``."""
        source = os.environ if env is None else env
        vllm_endpoint = str(source.get("VLLM_LLM_ENDPOINT", "") or source.get("VLLM_ENDPOINT", ""))
        generation_endpoint = vllm_endpoint or (
            f"http://{source.get('LLM_SERVER_HOST_IP', '0.0.0.0')}:{source.get('LLM_SERVER_PORT', '80')}"
        )
        translation_endpoint = str(source.get("VLLM_TRANSLATION_ENDPOINT", ""))
        slots = _env_int(source, "AGENT_LANE_SLOTS", 1)
        return cls(
            generation_endpoint=generation_endpoint,
            model_id_override=str(source.get("VLLM_LLM_MODEL_ID", "")),
            llm_timeout_seconds=_env_float(source, "MODEL_LLM_TIMEOUT_SECONDS", 180.0),
            system_prompt_override=str(source.get("CHATQNA_SYSTEM_PROMPT", "")).strip(),
            abstention_instructions_override=str(source.get("CHATQNA_ABSTENTION_INSTRUCTIONS", "")).strip(),
            enforce_abstention=_env_bool(source, "CHATQNA_ENFORCE_ABSTENTION", "true"),
            answer_tokens=_env_int(source, "AGENT_ANSWER_MAX_TOKENS", 0),
            fallback_window_tokens=_env_int(source, "MAX_MODEL_LEN_TEXTGEN", 65536),
            window_override_tokens=_env_int(source, "AGENT_WINDOW_OVERRIDE_TOKENS", 0),
            # The data-call bearer: an explicit OPENAI_API_KEY wins, and
            # the GPU-node key backs it up — an in-process run inherits the
            # operator's shell, not the compose mapping that fills
            # OPENAI_API_KEY from VLLM_API_KEY, and the canonical venue
            # carries only the GPU-node key.
            bearer=source.get("OPENAI_API_KEY") or source.get("VLLM_API_KEY"),
            probe_bearer=source.get("VLLM_API_KEY"),
            tls_verify=str(source.get("OPEA_SSL_SKIP_VERIFY", "")) != "1",
            probe_timeout_seconds=_env_float(source, "MODEL_PROBE_TIMEOUT_SECONDS", 10.0),
            detect_ttl_seconds=_env_int(source, "MODEL_DETECT_TTL", 60),
            answer_translation_enabled=_env_flag(source, "AGENT_ANSWER_TRANSLATION_ENABLED", "false"),
            translation_endpoint=translation_endpoint
            or (
                f"http://{source.get('TRANSLATION_SERVICE_HOST_IP', '0.0.0.0')}:"
                f"{source.get('TRANSLATION_SERVICE_PORT', '80')}"
            ),
            translation_model_id=str(source.get("VLLM_TRANSLATION_MODEL_ID", "")),
            translation_timeout_seconds=_env_int(source, "TRANSLATION_SERVICE_TIMEOUT", 180),
            lane_slots=max(1, slots),
            lane_lock_path=str(source.get("AGENT_LANE_LOCK_PATH", "/tmp/agent-service-lane.lock")),
            confidence_rank_decay=_env_float(source, "CONFIDENCE_RANK_DECAY", 0.5),
        )

    def model_config(self) -> VllmModelConfig:
        """The model's knobs, in the port's shape — the adapter's config.

        The deployed knob surface is read here, once; the adapter that
        consumes the knobs takes the port's shape.
        """
        return VllmModelConfig(
            generation_endpoint=self.generation_endpoint,
            model_id_override=self.model_id_override,
            bearer=self.bearer,
            discovery_bearer=self.probe_bearer,
            tls_verify=self.tls_verify,
            llm_timeout_seconds=self.llm_timeout_seconds,
            discovery_timeout_seconds=self.probe_timeout_seconds,
            window_override_tokens=self.window_override_tokens,
            fallback_window_tokens=self.fallback_window_tokens,
        )
