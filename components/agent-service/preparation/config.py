# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The frozen env-knob surface of the input-preparation module.

Every knob the deployed preparation pipeline reads (V02 §5,
``docs/baselines/v02-opea-query-path-contract.md``; the deployed module is
``genie-ai-overlay/chatqna/genieai_chatqna.py``) is read here under the SAME
name with the SAME code default, so a deployment that tunes the legacy
translation path tunes this module identically. The completion-cap constants
were code constants, not env knobs, in the deployed module and stay code
defaults here — carried as fields so a caller can see every number the
translation budget is made of in one frozen object.

The endpoint follows the deployed remote-vs-compose rule: ``VLLM_TRANSLATION_ENDPOINT``
set → that base URL is used directly for the translation call AND the
window/model discovery; unset → the compose-internal translation service at
``http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}``.
"""

import os
from dataclasses import dataclass
from pathlib import Path


def _env_int(source, name: str, default: int) -> int:
    """Parse an int env var tolerantly: unset OR set-to-empty (compose's
    default injection for the semantic knobs) or non-numeric values all
    fall back to the default instead of crash-looping the service at
    wiring time (deployed ``_env_int`` — issue #1091 fixed this crash
    class in the deployed module; the port inherits the tolerance)."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_float(source, name: str, default: float) -> float:
    """The float twin of :func:`_env_int` (deployed ``_env_float``)."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


# The package-relative default of the vendored language registry — the same
# resolution rule the deployed module uses (the registry is resolved next to
# the module, never against the working directory: a service started from
# another directory must not silently end up with an empty map).
DEFAULT_REGISTRY_PATH = str(Path(__file__).resolve().parent / "language-registry.json")

# How long an unreadable registry is remembered as unreadable (deployed
# LANGUAGE_MAP_RETRY_SECONDS): re-reading a broken file on every request is
# noise, but caching the failure forever would disable translation for the
# lifetime of the process after a transient read error.
REGISTRY_RETRY_SECONDS = 60.0

# How long a FAILED window probe is remembered (deployed NEGATIVE_CACHE_TTL
# in core/model_cache.py): bounds the retry storm to one probe per window.
NEGATIVE_CACHE_SECONDS = 60

# The history translation target. A constant, never an argument: the history
# is normalized to English — the language of the embedding space — whatever
# the caller asked the answer in (deployed HISTORY_TRANSLATION_TARGET).
HISTORY_TRANSLATION_TARGET = "en"


@dataclass(frozen=True)
class PreparationConfig:
    """Every number and name the preparation pipeline runs under."""

    translation_endpoint: str
    model_id: str
    service_timeout_seconds: int
    # MAX_TRANSLATION_CHARS: the fallback char budget when the window
    # discovery has no answer (deployed code default 2000).
    max_translation_chars: int
    # The explicit env value when the deployer set it (0 = unset): it only
    # LOWERS the derived budget, it never raises the code default. Kept
    # separate from `max_translation_chars` because the deployed derivation
    # caps only when the deployer set the knob — a default must not cap the
    # derived budget down (V02 §5.3: MAX_TRANSLATION_CHARS unset on the
    # venue; the derived budget was 11520, not 2000).
    max_translation_chars_cap: int
    prompt_overhead_tokens: int
    chars_per_token: int
    msg_overhead_chars: int
    completion_safety_tokens: int
    completion_min_room: int
    completion_needed_multiplier: int
    completion_needed_margin: int
    completion_base_ceiling: int
    registry_path: str
    probe_timeout_seconds: float
    detect_ttl_seconds: int
    # The translation call and its /tokenize count authenticate with the
    # OPENAI_API_KEY bearer (deployed: same server, same auth).
    bearer: str | None
    # The /v1/models probe authenticates with the VLLM_API_KEY bearer
    # (deployed endpoint_auth_headers — a contract applied to the probe and
    # the data calls alike, so one cannot succeed while the other 401s).
    probe_bearer: str | None
    tls_verify: bool

    @classmethod
    def load(cls, env=None) -> "PreparationConfig":
        """Read the knobs from the environment; ``env`` defaults to ``os.environ``."""
        source = os.environ if env is None else env
        vllm_endpoint = str(source.get("VLLM_TRANSLATION_ENDPOINT", ""))
        endpoint = vllm_endpoint or (
            f"http://{source.get('TRANSLATION_SERVICE_HOST_IP', '0.0.0.0')}:"
            f"{source.get('TRANSLATION_SERVICE_PORT', '80')}"
        )
        return cls(
            translation_endpoint=endpoint,
            model_id=str(source.get("VLLM_TRANSLATION_MODEL_ID", "")),
            service_timeout_seconds=_env_int(source, "TRANSLATION_SERVICE_TIMEOUT", 180),
            max_translation_chars=_env_int(source, "MAX_TRANSLATION_CHARS", 2000),
            # The explicit cap reads the SAME knob with no default: unset or
            # empty means 0 (no cap on the derived budget), exactly the
            # deployed two-read semantics.
            max_translation_chars_cap=_env_int(source, "MAX_TRANSLATION_CHARS", 0),
            # The completion-cap constants are the deployed code constants.
            prompt_overhead_tokens=512,
            chars_per_token=3,
            msg_overhead_chars=20,
            completion_safety_tokens=128,
            completion_min_room=256,
            completion_needed_multiplier=4,
            completion_needed_margin=256,
            completion_base_ceiling=4096,
            # The registry path is a PATH knob, not a semantic knob: deployed
            # parity keeps the bare getenv default (set-to-empty is honored
            # as the broken path it is, not silently repaired).
            registry_path=str(source.get("LANGUAGE_REGISTRY_FILEPATH", DEFAULT_REGISTRY_PATH)),
            probe_timeout_seconds=_env_float(source, "MODEL_PROBE_TIMEOUT_SECONDS", 10.0),
            detect_ttl_seconds=_env_int(source, "MODEL_DETECT_TTL", 60),
            bearer=source.get("OPENAI_API_KEY"),
            probe_bearer=source.get("VLLM_API_KEY"),
            tls_verify=str(source.get("OPEA_SSL_SKIP_VERIFY", "")) != "1",
        )
