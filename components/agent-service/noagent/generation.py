# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The fixed generation stage — one call to the LLM endpoint (story 1.9).

The recorded payload (deployed chatqna request-level defaults,
``genieai_chatqna.py:4890-4906``): ``temperature=0.01``, ``top_p=0.95``,
``frequency_penalty=0.0``, ``stream=false``; ``max_tokens`` omitted unless
the config carries one (the deployed rule: "Only set max_tokens when
explicitly provided — let the LLM use its own default"). The model id is
discovered from ``{endpoint}/v1/models`` (the endpoint is the only
trustworthy source — the image bakes no model cache), TTL-cached with a
negative cache for a failed probe; the ``VLLM_LLM_MODEL_ID`` override wins
when set (the deployer's escape hatch).

The window discovery shares the same probe (the deployed
``_get_max_model_len`` tiers: an explicit consumer-side cap wins, then the
probed ``max_model_len``, then the code default). The truncation guard in
:mod:`noagent.prompt` consumes it.

Failures are typed: a transport error, a non-2xx status, a non-200 protocol
shape or a cut-off completion raise :class:`GenerationTransientError` — the
turn fails, no fabricated answer. ``asyncio.CancelledError`` propagates
untouched (it is a ``BaseException``; nothing here catches ``Exception``
around the await without letting it through). The transport is injected so
the tests drive the client without a network — the same seam
:class:`preparation.translation.PreparationFakeTransport` answers.
"""

import logging
import time

from preparation.translation import (
    HttpxTransport,
    ModelEndpointCache,
    is_input_overflow,
    parse_tokenize_count,
)

from .config import WINDOW_BUFFER_TOKENS, NoAgentConfig

logger = logging.getLogger(__name__)


class GenerationTransientError(RuntimeError):
    """The generation endpoint failed transiently; the turn fails.

    One class for every failure shape the endpoint can produce (transport,
    status, protocol, truncation): config B has no retry, no fallback and no
    degradation for a failed generation — the deployed chat path fails the
    turn (503 llm_unavailable for a model/transport error, otherwise 500)
    and this pipeline fails it the same way, at the capability layer.
    """


RECORDED_SAMPLING_PARAMS = {"temperature": 0.01, "top_p": 0.95, "frequency_penalty": 0.0, "stream": False}
"""The recorded request-level sampling params, shared by every chat/completions
consumer in the component — one home, so a change to the deployed convention
cannot leave one consumer measuring a different request than the others."""


def generation_payload(system_prompt: str, user_content: str, model_id: str | None, answer_tokens: int | None) -> dict:
    """The recorded request body: two chat messages, the fixed params.

    ``max_tokens`` is carried only when the caller configured one — omitted
    means the server's own default answers (deployed parity; the truncation
    guard still reserves the deployed 3896-token answer budget against the
    window when planning history).
    """
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        **RECORDED_SAMPLING_PARAMS,
    }
    if answer_tokens:
        payload["max_tokens"] = answer_tokens
    return payload


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


class GenerationClient:
    """The one generation call config B makes per turn.

    The endpoint cache (window + model id, one probe, TTL) and the transport
    are constructor-injected; ``create()`` assembles the default wiring.
    """

    def __init__(self, config: NoAgentConfig, cache: ModelEndpointCache, transport):
        self._config = config
        self._cache = cache
        self._transport = transport

    @property
    def transport(self):
        """The transport this client was wired with — the same seam the
        token counter reads, so a wiring change lands once."""
        return self._transport

    @classmethod
    def create(cls, config: NoAgentConfig, transport=None) -> "GenerationClient":
        transport = transport or HttpxTransport(config.tls_verify)
        cache = ModelEndpointCache(
            config.generation_endpoint, transport, config.probe_timeout_seconds, config.detect_ttl_seconds
        )
        return cls(config, cache, transport)

    async def model_id(self) -> str | None:
        """The model id: the explicit override when set, else the discovered one.

        None is a valid state only for a lenient server: vLLM validates the
        model name and 404s unknown ones, so a failed discovery with no
        override fails the turn at generation time (deployed: the model-id
        getter fails loudly when nothing answers).
        """
        if self._config.model_id_override:
            return self._config.model_id_override
        return await self._cache.model_id(self._config)

    async def window_tokens(self) -> int:
        """The usable context window in tokens, in the deployed three tiers:
        an explicit consumer-side cap, then the probed ``max_model_len``,
        then the code default."""
        if self._config.window_override_tokens > 0:
            return self._config.window_override_tokens
        detected = await self._cache.max_model_len(self._config)
        if detected:
            return detected
        return self._config.fallback_window_tokens

    async def generate(self, system_prompt: str, user_content: str) -> str:
        """One non-streaming generation; the finished text, or a typed failure.

        Raises:
            GenerationTransientError: the endpoint was unreachable, answered
                a non-2xx status, answered a shape this client cannot read,
                or cut the completion off at its budget. Never a fabricated
                or empty answer.
        """
        model_id = await self.model_id()
        payload = generation_payload(system_prompt, user_content, model_id, self._config.answer_tokens or None)
        url = f"{self._config.generation_endpoint}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self._config.bearer}"} if self._config.bearer else {}
        started = time.monotonic()
        try:
            status, body = await self._transport.post_json(url, headers, payload, self._config.llm_timeout_seconds)
        except Exception as e:  # noqa: BLE001 — every transport failure is transient
            # A vLLM context-length rejection is the caller's budget bug, not
            # an outage — say so in the message, the typed class is the same
            # (config B has no context-overflow fallback: the truncation
            # guard above the call is what prevents this).
            if is_input_overflow(e):
                raise GenerationTransientError(
                    f"the generation request exceeded the model window: {type(e).__name__}: {str(e)[:200]}"
                ) from e
            raise GenerationTransientError(f"the generation call failed: {type(e).__name__}: {str(e)[:200]}") from e
        if status >= 400:
            raise GenerationTransientError(f"the generation endpoint answered {status}: {str(body)[:200]}")
        if not isinstance(body, dict):
            raise GenerationTransientError(f"the generation endpoint answered a {type(body).__name__}, not an object")
        choice, finish_reason = chat_choice(body)
        if choice is None:
            raise GenerationTransientError("the generation response carries no choice")
        if finish_reason == "length":
            raise GenerationTransientError(
                "the generation hit its token budget and was cut off; no answer is fabricated"
            )
        content = chat_choice_content(choice)
        if not isinstance(content, str) or not content.strip():
            raise GenerationTransientError("the generation response carried no text content")
        logger.info("generation finished in %.2fs (%d chars)", time.monotonic() - started, len(content))
        return content


class TokenCounter:
    """Counts tokens with the generation endpoint's own ``/tokenize``.

    The server that serves generation tokenizes with the deployed model's
    REAL tokenizer — the counts the context-window budget needs, with no
    local tokenizer download (the image bakes no HF cache and grants no hub
    egress; deployed ``_count_tokens``). Failures are LOUD and on purpose:
    the truncation guard's budget math runs on these counts, so an
    unreachable endpoint or a malformed count payload aborts the turn
    rather than silently corrupting the history truncation. The transport is
    injected; the request shape and auth follow the deployed call (the
    ``Bearer VLLM_API_KEY`` probe contract, the probe timeout).
    """

    def __init__(self, config: NoAgentConfig, model_id_getter, transport):
        self._config = config
        self._model_id_getter = model_id_getter
        self._transport = transport

    async def count(self, text: str) -> int:
        """The token count of ``text`` under the served model's tokenizer.

        Raises:
            GenerationTransientError: the endpoint did not answer a usable
                count — never a guessed number.
        """
        model_id = await self._model_id_getter()
        url = f"{self._config.generation_endpoint}/tokenize"
        headers = {"Authorization": f"Bearer {self._config.probe_bearer}"} if self._config.probe_bearer else {}
        try:
            status, body = await self._transport.post_json(
                url, headers, {"model": model_id, "prompt": text}, self._config.probe_timeout_seconds
            )
        except Exception as e:  # noqa: BLE001 — a count failure is a turn failure, not a guess
            raise GenerationTransientError(f"the token count failed: {type(e).__name__}: {str(e)[:200]}") from e
        if status >= 400:
            raise GenerationTransientError(f"the tokenize endpoint answered {status}: {str(body)[:200]}")
        try:
            # preparation's ONE tokenize parser (same payload read, the sane
            # absurd-count ceiling included); its ValueError maps to the
            # counter's typed failure — never a guessed number.
            return parse_tokenize_count(body)
        except ValueError as e:
            raise GenerationTransientError(str(e)[:200]) from e


def window_fits(payload_prompt_tokens: int, answer_tokens: int, window_tokens: int) -> bool:
    """The deployed over-window predicate: ``prompt + answer > window − 200``.

    Exposed for :mod:`noagent.prompt` and its tests so the guard's threshold
    is read from one place.
    """
    return payload_prompt_tokens + answer_tokens <= window_tokens - WINDOW_BUFFER_TOKENS
