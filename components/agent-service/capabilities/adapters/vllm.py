# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The vLLM model client — the OpenAI-compatible completion over the injected
transport.

The client mirrors the component's recorded conventions — non-streaming, the
fixed sampling params, model discovery from ``/v1/models`` with the
``VLLM_LLM_MODEL_ID`` override — over the injected transport (the same
seam ``PreparationFakeTransport`` answers in tests). One client per
process; the discovered model id is resolved once.

It is an adapter: the core drives the ``LoopModelClient`` protocol, and the
shapes it returns are the port's.
"""

import json
import math

from capabilities.model import (
    MODEL_CHARS_PER_TOKEN_ESTIMATE,
    MODEL_INPUT_SAFETY_TOKENS,
    MODEL_PROMPT_OFFSET_TOKENS,
    MODEL_SOURCE_DISCOVERED,
    MODEL_SOURCE_OVERRIDE,
    MODEL_SOURCE_UNRESOLVED,
    RECORDED_SAMPLING_PARAMS,
    ModelTurn,
    ToolCallRequest,
    VllmModelConfig,
    chat_choice,
    chat_choice_content,
    coerce_sane_int,
    resolve_window_tokens,
)


class VllmTransientError(RuntimeError):
    """The model endpoint failed transiently or answered a shape the probe
    cannot read; the run fails instead of fabricating. ``CancelledError``
    never becomes one — it propagates untouched."""


class VllmModelClient:
    """The OpenAI-compatible model client (a ``LoopModelClient``), shared by
    the probe and the run surface.

    Mirrors the recorded generation conventions — non-streaming, the fixed
    sampling params, model discovery from ``/v1/models`` with the
    ``VLLM_LLM_MODEL_ID`` override — over the injected transport (the same
    seam ``PreparationFakeTransport`` answers in tests). One client per
    process; the discovered model id is resolved once.
    """

    def __init__(self, config: VllmModelConfig, transport):
        self._config = config
        self._transport = transport
        self._model_id: str | None = None
        self._discovered_window: int | None = None
        self._window: int | None = None

    async def _resolve_model_id(self) -> str:
        if self._config.model_id_override:
            return self._config.model_id_override
        if self._model_id is None:
            url = f"{self._config.generation_endpoint}/v1/models"
            bearer = self._config.discovery_bearer
            headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
            try:
                status, body = await self._transport.get_json(url, headers, self._config.discovery_timeout_seconds)
            except Exception as e:  # noqa: BLE001 — every discovery failure is transient
                raise VllmTransientError(f"the model discovery failed: {type(e).__name__}: {str(e)[:200]}") from e
            if status >= 400:
                raise VllmTransientError(f"the model discovery answered {status}: {str(body)[:200]}")
            data = body.get("data") if isinstance(body, dict) else None
            entry = data[0] if data and isinstance(data[0], dict) else None
            if not entry or not entry.get("id"):
                raise VllmTransientError("the model discovery carried no model id")
            self._model_id = str(entry["id"])
            # The same probe serves the window the one-call cap is anchored
            # on; a garbage or absent value falls to the configured tier.
            # A proxy may serialize the served window as a float or a digit
            # string, so the value rides the shared coercion-then-sane-bound
            # stance: an absurd value must not disable the overflow guard.
            discovered = coerce_sane_int(entry.get("max_model_len"))
            if discovered is not None:
                self._discovered_window = discovered
        return self._model_id

    async def model_identity(self) -> tuple[str | None, str, str | None]:
        """The execution-version record's model axis, resolved FAIL-SOFT.

        The override wins without a probe (``override``); discovery reuses
        the same ``/v1/models`` GET — and the same per-client cache — the
        first model call runs (``discovered``); a discovery failure degrades
        to the unresolved identity carrying the truncated reason, never an
        exception past the run (the I/O matrix row: the record is built at
        assembly and the run proceeds).
        """
        if self._config.model_id_override:
            return self._config.model_id_override, MODEL_SOURCE_OVERRIDE, None
        try:
            return await self._resolve_model_id(), MODEL_SOURCE_DISCOVERED, None
        except VllmTransientError as failed:
            # The note rides raw — build_execution_version_record is the
            # single clamp home (_NOTE_LIMIT).
            return None, MODEL_SOURCE_UNRESOLVED, str(failed)

    async def _window_tokens(self) -> int:
        """The window one call must fit — the deployed three tiers of
        :func:`noagent.generation.resolve_window_tokens`, resolved once per
        client like the model id; the probed tier is this client's own
        single-discovery capture."""
        if self._window is None:
            await self._resolve_model_id()  # idempotent; runs the probe when no override
            self._window = resolve_window_tokens(self._config, self._discovered_window)
        return self._window

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn:
        """One non-streaming tool-calling completion, or a typed failure.

        ``max_output_tokens`` rides the request as ``max_tokens`` when the
        caller has a bound to state — omitted otherwise (the deployed
        only-when-configured rule). The bound is capped to what ONE call
        can serve: the run-level allowance may exceed the endpoint's
        window, and a ``max_tokens`` beyond the window makes vLLM reject
        the call outright — so the bound sent is the smaller of the
        allowance and the window room. An oversized prompt (room <= 0)
        omits the field and fails honestly on its own.
        """
        model_id = await self._resolve_model_id()
        payload = {
            "model": model_id,
            "messages": messages,
            **RECORDED_SAMPLING_PARAMS,
        }
        if tool_definitions:
            # Tool-shaped only when there are tools to declare: an empty
            # `tools: []` is not portable across OpenAI-compatible
            # endpoints (several validators reject it with 400), and the
            # aux callers (the grounding judge) legitimately speak without
            # a toolset.
            payload["tools"] = list(tool_definitions)
            payload["tool_choice"] = "auto"
        if max_output_tokens is not None:
            window = await self._window_tokens()
            # The offset is added AFTER the estimate: the +20 prompt-offset
            # tokens are tokens, not characters — inside the division they
            # would contribute only 5.
            # The declared tools are part of the request the endpoint sees,
            # so their serialized size counts against the room too: for a
            # tool-shaped call the schemas are the dominant term, and a
            # room computed without them overstates what one call can serve.
            request_chars = len(json.dumps(messages)) + len(json.dumps(payload.get("tools", [])))
            input_tokens = math.ceil(request_chars / MODEL_CHARS_PER_TOKEN_ESTIMATE) + MODEL_PROMPT_OFFSET_TOKENS
            room = window - input_tokens - MODEL_INPUT_SAFETY_TOKENS
            if room > 0:
                payload["max_tokens"] = min(max_output_tokens, room)
        url = f"{self._config.generation_endpoint}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self._config.bearer}"} if self._config.bearer else {}
        try:
            status, body = await self._transport.post_json(url, headers, payload, self._config.llm_timeout_seconds)
        except Exception as e:  # noqa: BLE001 — every transport failure is transient
            raise VllmTransientError(f"the generation call failed: {type(e).__name__}: {str(e)[:200]}") from e
        if status >= 400:
            raise VllmTransientError(f"the generation endpoint answered {status}: {str(body)[:200]}")
        if not isinstance(body, dict):
            raise VllmTransientError(f"the generation endpoint answered a {type(body).__name__}, not an object")
        choice, finish_reason = chat_choice(body)
        if choice is None:
            raise VllmTransientError("the generation response carries no choice")
        message = choice.get("message") or {}
        content = chat_choice_content(choice)
        return ModelTurn(
            content=content if isinstance(content, str) else None,
            tool_calls=self._parse_tool_calls(message.get("tool_calls")),
            finish_reason=finish_reason,
            prompt_tokens=self._usage_field(body, "prompt_tokens"),
            completion_tokens=self._usage_field(body, "completion_tokens"),
        )

    @staticmethod
    def _parse_tool_calls(raw) -> tuple[ToolCallRequest, ...]:
        if not raw:
            return ()
        if not isinstance(raw, list):
            raise VllmTransientError("the generation response carries malformed tool calls")
        requests = []
        for entry in raw:
            if not isinstance(entry, dict) or not isinstance(entry.get("function"), dict):
                raise VllmTransientError("the generation response carries malformed tool calls")
            function = entry["function"]
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, ValueError) as error:
                raise VllmTransientError(f"the tool-call arguments are not valid JSON: {error}") from error
            if not isinstance(arguments, dict):
                raise VllmTransientError("the tool-call arguments are not a JSON object")
            # An absent id is a response-shape defect, not a tolerable one:
            # the loop echoes the id back as tool_call_id on the follow-up
            # request, and a strict OpenAI-compatible server (vLLM validates
            # tool-call ids) would reject the shared-empty-id turn. Failing
            # the probe here names the defect instead of disguising it.
            if not entry.get("id"):
                raise VllmTransientError("a tool call carries no id; the endpoint's response shape is malformed")
            requests.append(
                ToolCallRequest(
                    call_id=str(entry["id"]),
                    name=str(function.get("name") or ""),
                    arguments=arguments,
                )
            )
        return tuple(requests)

    @staticmethod
    def _usage_field(body: dict, name: str) -> int | None:
        # The shared coerce_int stance: proxies serialize numbers as floats
        # or digit strings, and a boolean is never a count — the old
        # isinstance(int) gate flagged every float/string-served record
        # "incomplete" and left token enforcement degraded to a lower
        # bound for the run (agent/budget.py check_tokens). The sane cap
        # mirrors _coerce_window: a garbage-but-integral record (e.g.
        # 1e15) must not read as a spent budget and end the run as
        # budget-exhausted.
        usage = body.get("usage")
        if isinstance(usage, dict):
            return coerce_sane_int(usage.get(name))
        return None
