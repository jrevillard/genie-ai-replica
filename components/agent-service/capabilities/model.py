# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The model call's contract: what a model turn IS, and the seam that
produces one.

The two dataclasses and the protocol live here, not in the core's loop:
the client that produces a turn is an adapter, and an adapter may not
import the core (rule L1 binds the leaf adapters to the ports). The core
and the adapters exchange these shapes, so they are a port.
"""

import math
from dataclasses import dataclass
from typing import Protocol

# The model identity's vocabulary: where the served model id came from.
MODEL_SOURCE_OVERRIDE = "override"
MODEL_SOURCE_DISCOVERED = "discovered"
MODEL_SOURCE_UNRESOLVED = "unresolved"

# The recorded request-level sampling params, shared by every
# chat/completions consumer in the component — one home, so a change to the
# deployed convention cannot leave one consumer measuring a different
# request than the others.
RECORDED_SAMPLING_PARAMS = {"temperature": 0.01, "top_p": 0.95, "frequency_penalty": 0.0, "stream": False}

# The prompt-size estimate the per-call output bound is computed against:
# the characters per token, the prompt offset the estimate carries, and the
# safety room the bound keeps for the endpoint's own framing.
MODEL_CHARS_PER_TOKEN_ESTIMATE = 4
MODEL_PROMPT_OFFSET_TOKENS = 20
MODEL_INPUT_SAFETY_TOKENS = 128


def chat_choice(body: dict) -> tuple[dict | None, str | None]:
    """The first choice and its finish reason out of an OpenAI-shaped chat
    response — the ONE shape reader for every chat/completions consumer in
    the no-agent package (the generation client and the answer translator;
    each maps the outcome to its own failure style)."""
    choices = body.get("choices") or []
    choice = choices[0] if choices and isinstance(choices[0], dict) else None
    return choice, (choice or {}).get("finish_reason")


def chat_choice_content(choice: dict):
    """The message content of one choice (None when the shape carries none)."""
    return (choice.get("message") or {}).get("content")


def chat_completions_url(endpoint: str) -> str:
    """The chat/completions URL of an OpenAI-compatible endpoint.

    One home for the URL shape: the generation client, the answer
    translator and the agentic model client all address the same
    endpoint, and a change to the path must not leave one of them
    pointing elsewhere. The endpoint is concatenated verbatim — the
    recorded convention, byte for byte.
    """
    return f"{endpoint}/v1/chat/completions"


def chat_auth_headers(bearer: str | None) -> dict:
    """The Authorization headers one direct model-endpoint call carries.

    The bearer per call, never on a session (deployed: same server, same
    auth). No key, no header.
    """
    return {"Authorization": f"Bearer {bearer}"} if bearer else {}


def chat_payload(model_id: str | None, messages: list[dict], **extra) -> dict:
    """The chat/completions request body: the model, the messages and the
    recorded sampling params.

    One home for the recorded request shape — every consumer of the
    OpenAI-compatible endpoint builds it here, so the recorded convention
    cannot leave one of them measuring a different request than the others.
    ``extra`` carries the per-consumer fields (the toolset, the answer
    bound).
    """
    return {"model": model_id, "messages": messages, **RECORDED_SAMPLING_PARAMS, **extra}


@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model asked for: its wire id, name, arguments."""

    call_id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelTurn:
    """One model call's outcome, in the loop's own shape.

    ``content`` is the final text when the turn answers; ``tool_calls``
    carries the requested dispatches when the turn works. Usage is the
    token accounting as the endpoint served it (``None`` when the endpoint
    discarded it) — the evidence record reports usage as served, never a
    local estimate.
    """

    content: str | None = None
    tool_calls: tuple[ToolCallRequest, ...] = ()
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LoopModelClient(Protocol):
    """The model-call seam the loop drives — one non-streaming completion.

    The concrete OpenAI-compatible client is the runtime's business (the
    probe carries one, shared with the run surface); the loop depends on
    this shape only, which is what keeps the loop runtime-swappable.
    ``max_output_tokens`` is the remaining token allowance the monitor
    hands the call — the token bound riding the request (``None`` when the
    allowance is unknowable and the field must be omitted, the deployed
    only-when-configured rule). The IMPLEMENTER caps the bound to what one
    call can serve — ``min(bound, window room)``, omitting the field when
    there is no room — because a cumulative RUN allowance may exceed the
    endpoint's window, and an unanchored ``max_tokens`` is rejected
    outright.
    """

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn: ...


def resolve_window_tokens(config, detected: int | None) -> int:
    """The usable context window in tokens, in the deployed three tiers: an
    explicit consumer-side cap (``AGENT_WINDOW_OVERRIDE_TOKENS``), then the
    probed ``max_model_len``, then the configured fallback
    (``MAX_MODEL_LEN_TEXTGEN``). Pure — the caller supplies the probed
    value (the ``ModelEndpointCache`` here, the vLLM client's own single
    discovery) so both consumers share one tier home.
    """
    if config.window_override_tokens > 0:
        return config.window_override_tokens
    if detected:
        return detected
    return config.fallback_window_tokens


def coerce_int(value) -> int | None:
    """Coerce a JSON scalar to ``int``: bools rejected, digit strings accepted.

    Shared stance for every numeric field read out of a model-server payload
    (context windows, tokenize counts): proxies serialize numbers as digit
    strings, and a boolean is never a count.

    A digit string is a plain run of ASCII decimal digits. The ``int()``
    builtin is looser — it also accepts PEP 515 underscore separators
    (``"1_0"`` becomes 10), a leading sign (``"+5"``) and non-ASCII decimal
    digits (``"١٢٣"`` becomes 123) — and a mangled count silently
    miscounts the served tokens.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        # 12.0 is a serialization of 12; 12.5 is garbage.
        return int(value) if math.isfinite(value) and int(value) == value else None
    if isinstance(value, str):
        text = value.strip()
        return int(text) if text.isascii() and text.isdecimal() else None
    return None


def coerce_sane_int(value) -> int | None:
    """Coerce a JSON scalar to an int inside the sane token bound, or None.

    The one home for the coercion-then-bound predicate every numeric field
    read out of a model-server payload applies (served context windows,
    usage counts): the coercion is :func:`coerce_int`, and a value past
    ``MAX_SANE_TOKENS`` (or not positive) is dropped — an absurd value
    would silently disable the overflow guard it feeds.
    """
    coerced = coerce_int(value)
    if coerced is not None and 0 < coerced <= MAX_SANE_TOKENS:
        return coerced
    return None


MAX_SANE_TOKENS = 10_000_000


@dataclass(frozen=True)
class VllmModelConfig:
    """The model leg's knobs — the endpoint, the model, the postures.

    A pure shape: the deployed knob surface is read by the core's config
    (``NoAgentConfig``), which builds this one — one home for the reading
    rules, one home for the shape the adapter takes.
    """

    generation_endpoint: str
    model_id_override: str
    bearer: str | None
    discovery_bearer: str | None
    tls_verify: bool
    llm_timeout_seconds: float
    discovery_timeout_seconds: float
    window_override_tokens: int
    fallback_window_tokens: int
