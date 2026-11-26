# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The translation client: the one seam behind history preparation.

Ported from the deployed translation seam (``genieai_chatqna.py``: the
payload builders :632-708, the seam :711-795, the window discovery :821-828,
the /tokenize counter :2378-2444, the prompt builders :3994-4082 and
:4385-4444; the window/model cache is the port of
``genie-ai-overlay/core/model_cache.py``, reimplemented — clean-slate,
no shared library with the overlay).

The behavior is frozen to the recorded preparation contract (the bounds,
the failure classes):

* the completion budget is MEASURED (the translation server's own
  ``/tokenize`` count of the payload's prompt half) whenever the server can
  count; a permanent inability to count latches once and the degraded
  estimate bounds the completion instead;
* a prompt that does not fit the window refuses LOUD
  (:class:`TranslationInputTooLongError`) — never an untranslated fallback,
  whatever the history shape;
* a timeout is its own typed subclass (:class:`TranslationTimeoutError`) so
  the caller can report ``fallback_timeout``; every other failure is a
  :class:`TranslationFailedError` (``fallback_error``), and a cut-off or
  empty completion is a FAILURE, never a silent success;
* ``asyncio.CancelledError`` propagates untouched — it is a
  ``BaseException``, so the classification below never catches it, and no
  handler in this module maps it to any status.

The transport is injected (constructor), so the tests drive the client
without a network. The production transport is a per-call
``httpx.AsyncClient`` — the deployed seam's shape (bearer header, service
timeout, TLS-verify knob).
"""

import logging
import math
import re
import time
from contextlib import suppress
from typing import Any, Protocol

from .config import NEGATIVE_CACHE_SECONDS, PreparationConfig

logger = logging.getLogger(__name__)

# Sanity ceiling for a probed window or a tokenize count (deployed
# MAX_SANE_MODEL_WINDOW_TOKENS): the largest real models sit two orders of
# magnitude below this; anything bigger is a broken proxy value that would
# silently disable every truncation guard.
MAX_SANE_TOKENS = 10_000_000

# The shape a language code has to have before it is written into a prompt
# (deployed _LANGUAGE_CODE_PATTERN). A code that does not look like a code is
# not one: it is replaced by the default rather than carried into the prompt.
_LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}(-[a-z0-9]{2,8})?$")


class TranslationInputTooLongError(RuntimeError):
    """Raised when the input does not fit the translation window.

    The refusal class — the recorded abstention class: the
    turn is refused, never answered with an untranslated fallback. The
    single-message shape refuses at the character budget (before the
    language map — the refusal must not depend on registry health); either
    shape refuses when the measured completion cap finds no room in the
    window or the server rejects the request with an overflow marker.
    """


class TranslationFailedError(RuntimeError):
    """Raised when a translation could not be produced.

    The translation model failed, answered with something unusable, or was
    cut off mid-completion. The caller reports ``fallback_error`` — a
    degradation the caller answers around, never a prepared label on source
    text.
    """


class TranslationTimeoutError(TranslationFailedError):
    """A translation timed out waiting for the model.

    A subtype, not a separate family: every ``except TranslationFailedError``
    keeps working, while the caller reports ``fallback_timeout`` for this one
    — the recorded vocabulary separates "the service was slow" from "the service
    is broken".
    """


class _ResponseStatusError(Exception):
    """The endpoint answered with a non-2xx status.

    Carries the parsed body in its message so the overflow classifier — which
    reads the string surface of an exception — sees the error body the way
    the deployed ``raise_for_status()`` + ``response.text`` path exposed it.
    """

    def __init__(self, status: int, body):
        self.status = status
        super().__init__(f"the translation endpoint answered {status}: {body}")


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


# Token-budget markers in vLLM/OpenAI error bodies (ported from the dataprep
# fail-loud pattern, ``genieai_dataprep_arangodb.py:79-84``; agent-service has
# no dataprep to import from — reimplemented, never imported).
_VLLM_CONTEXT_OVERFLOW_MARKERS = (
    "context length",
    "context_length_exceeded",
    "maximum context length",
    "reduce the length",
    "context window",
)


def _overflow_message_from_exc(exc: BaseException) -> str:
    """Aggregate every string-shaped field of an exception into one lowercased haystack.

    Production transports put the vLLM error body in different places:
    ``httpx.HTTPStatusError`` carries it on ``exc.response.text`` (``str(exc)``
    is only the status phrase), a bare ``Exception`` (test doubles) carries it
    in ``str(exc)``. Union all of these so the classifier matches the LIVE
    shape, not just the shape the unit tests happen to raise.
    """
    parts: list[str] = []
    # A hostile __str__ must not break classification, and neither may a
    # hostile body attribute.
    with suppress(Exception):
        parts.append(str(exc) or "")
    with suppress(Exception):
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("detail") or ""
                if msg:
                    parts.append(str(msg))
        elif isinstance(body, str):
            parts.append(body)
    resp = getattr(exc, "response", None)
    if resp is not None:
        text = getattr(resp, "text", None)
        if text:
            parts.append(str(text))
    msg = getattr(exc, "message", None)
    if msg and isinstance(msg, str):
        parts.append(msg)
    return " ".join(parts).lower()


def parse_tokenize_count(payload) -> int:
    """The token count out of a ``/tokenize`` payload — the ONE parser for
    every ``/tokenize`` consumer in the component (the translation client's
    completion cap and the no-agent pipeline's truncation guard).

    vLLM returns both the token list and a precomputed count; prefer the
    scalar, fall back to the list length. A proxy may serialize the count
    as a digit string (the same coercion stance as the window value).

    Raises:
        ValueError: the payload is not a readable count — never a guessed
        number, never an absurd one.
    """
    if not isinstance(payload, dict):
        raise ValueError(f"/tokenize returned a non-object payload: {payload!r}")
    raw = payload.get("count")
    if raw is None:
        tokens = payload.get("tokens")
        if not isinstance(tokens, list):
            raise ValueError(f"/tokenize payload has neither a count nor a token list: {payload!r}")
        count = len(tokens)
    else:
        count = coerce_int(raw)
        if count is None:
            raise ValueError(f"/tokenize count is not an integer: {raw!r}")
    if count < 0:
        # 0 is an honest count for an empty piece; a negative count is a
        # lie that would silently defeat the overflow guard.
        raise ValueError(f"/tokenize count is negative: {raw!r}")
    if count > MAX_SANE_TOKENS:
        raise ValueError(f"/tokenize count is absurdly large: {raw!r}")
    return count


def is_input_overflow(exc: BaseException) -> bool:
    """True when ``exc`` represents a vLLM context-length rejection.

    Generous matcher: any text-shaped surface of the exception containing one
    of the well-known overflow markers classifies as overflow — the request
    exceeded the window, and the caller must refuse, never fall back.
    """
    haystack = _overflow_message_from_exc(exc)
    if not haystack:
        return False
    return any(marker in haystack for marker in _VLLM_CONTEXT_OVERFLOW_MARKERS)


def classify_transport_error(exc: Exception) -> TranslationFailedError:
    """Map one transport failure onto the typed family (deployed seam, :742-759).

    Overflow first (fail loud), timeout second (its own status), everything
    else generic. ``asyncio.CancelledError`` never reaches here: it is a
    ``BaseException`` and this function takes ``Exception`` — a cancelled
    call propagates untouched, never mapped to any status.
    """
    if is_input_overflow(exc):
        return TranslationInputTooLongError(
            f"translation request exceeds the translation window: {type(exc).__name__}: {str(exc)[:200]}"
        )
    if isinstance(exc, TimeoutError):
        return TranslationTimeoutError(f"translation timed out: {type(exc).__name__}: {str(exc)[:200]}")
    return TranslationFailedError(f"translation failed: {type(exc).__name__}: {str(exc)[:200]}")


class TranslationTransport(Protocol):
    """The transport seam: the two HTTP verbs the client needs.

    Implementations return ``(status, parsed body)`` or raise. Raw transport
    exceptions (a timeout, connection errors, test doubles' arbitrary
    exceptions) propagate to the client's classification.
    """

    async def get_json(self, url: str, headers: dict, timeout_s: float) -> tuple[int, Any]: ...

    async def post_json(self, url: str, headers: dict, payload: dict, timeout_s: float) -> tuple[int, Any]: ...


class ModelEndpointCache:
    """The window/model-id discovery, ported from ``core/model_cache.py``.

    One probe of ``GET {endpoint}/v1/models`` feeds both the model id and
    ``max_model_len``; the entry is cached for the detect TTL, re-probed on
    expiry, and served STALE when a re-probe fails (stale is better than
    broken). A failed window probe is remembered for the negative-cache
    window so an unreachable endpoint costs one probe per window instead of
    one per request; the model id keeps retrying on every access (deployed:
    the negative cache covers only the request-path window field).
    """

    def __init__(self, endpoint: str, transport: TranslationTransport, probe_timeout_s: float, ttl_s: int):
        self._endpoint = endpoint
        self._transport = transport
        self._probe_timeout_s = probe_timeout_s
        self._ttl_s = ttl_s
        self._model_id: str | None = None
        self._max_model_len: int | None = None
        self._ts: float | None = None
        self._last_fail_ts: float | None = None

    @staticmethod
    def _probe_headers(config: PreparationConfig) -> dict:
        # The probe authenticates like every other direct model-endpoint call
        # (deployed endpoint_auth_headers): the VLLM_API_KEY bearer when set.
        return _auth_headers(config.probe_bearer)

    async def _probe(self, config: PreparationConfig) -> bool:
        """One ``/v1/models`` probe; True when a usable entry came back."""
        url = f"{self._endpoint}/v1/models"
        try:
            status, body = await self._transport.get_json(url, self._probe_headers(config), self._probe_timeout_s)
            if status >= 400:
                raise _ResponseStatusError(status, body)
            models = body if isinstance(body, dict) else {}
            data = models.get("data")
            if not data:
                logger.warning("model_cache: no models returned by %s/v1/models", self._endpoint)
                return False
            entry = data[0]
            if not isinstance(entry, dict):
                entry = {"id": entry}
            if entry.get("id") is None:
                logger.warning("model_cache: %s/v1/models returned an entry with no model id", self._endpoint)
                return False
            self._model_id = entry.get("id")
            self._max_model_len = self._coerce_window(entry.get("max_model_len"))
            self._ts = time.monotonic()
            if self._max_model_len is None:
                logger.warning(
                    "model_cache: %s/v1/models does not expose max_model_len "
                    "(strict OpenAI-compatible provider?); callers must fall back "
                    "to their configured context window",
                    self._endpoint,
                )
            return True
        except Exception as e:  # noqa: BLE001 — any probe failure is non-fatal (deployed stance)
            logger.warning("model_cache: probe failed for %s: %s", self._endpoint, e)
            return False

    @staticmethod
    def _coerce_window(value) -> int | None:
        """A probed ``max_model_len`` to a usable int, or None.

        Non-positive, non-integral, absurdly large and garbage values are
        dropped so a bad payload never poisons the cache entry — an absurdly
        large window would silently disable the truncation guard.
        """
        return coerce_sane_int(value)

    async def max_model_len(self, config: PreparationConfig) -> int | None:
        """The served window, TTL-cached; stale-served on a failed re-probe."""
        now = time.monotonic()
        if self._ts is not None and (now - self._ts) < self._ttl_s:
            return self._max_model_len
        if self._last_fail_ts is not None and (now - self._last_fail_ts) < NEGATIVE_CACHE_SECONDS:
            # Recently failed: answer from the entry without re-probing.
            return self._max_model_len
        probed = await self._probe(config)
        if not probed:
            self._last_fail_ts = now
        return self._max_model_len

    async def model_id(self, config: PreparationConfig) -> str | None:
        """The served model id, sharing the probe and the cache entry."""
        now = time.monotonic()
        if self._ts is not None and (now - self._ts) < self._ttl_s:
            return self._model_id
        await self._probe(config)
        return self._model_id


def translation_payload(prompt: str, translategemma: bool, model_id: str | None) -> tuple[dict, str, dict]:
    """The request shape for one translation prompt: the payload, the endpoint
    path, and the prompt half the token count must measure.

    The count body is the payload's prompt half AS IT WILL BE SENT, so the
    count covers what the server will tokenize (the chat template included).
    TranslateGemma takes the completions API with a pre-formatted prompt
    (vLLM cannot pass structured content through chat completions to its
    template); every other model takes the chat completions API with a single
    user message and no model name (the server answers with its default).
    """
    if translategemma:
        payload = {
            "model": model_id,
            "prompt": prompt,
            "temperature": 0.0,
            "repetition_penalty": 1.2,
        }
        return payload, "/v1/completions", {"prompt": prompt, "model": model_id}
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "stream": False,
    }
    return payload, "/v1/chat/completions", {"messages": payload["messages"]}


def _choice_content(choice: dict, completions: bool) -> str:
    """The text of a completion, whatever payload shape carries it.

    The chat shape nests it under ``message.content``, the completions shape
    under ``text``; a server that cut the completion off before any token can
    leave the content null. The read never raises: a missing or null content
    is an empty completion, which the caller refuses.
    """
    raw = choice.get("text") if completions else (choice.get("message") or {}).get("content")
    return (raw or "").strip()


def _completion_truncated(choice: dict) -> bool:
    """True when the server cut the completion off at ``max_tokens``.

    ``length`` is the OpenAI name for the condition. A cut-off completion is
    not a translation: embedding it would put a half-translated history into
    the retrieval space under a success status.
    """
    return choice.get("finish_reason") == "length"


def _auth_headers(bearer: str | None) -> dict:
    """The Authorization headers one direct model-endpoint call carries
    (deployed: same server, same auth — the bearer per call, never on a
    session). No key, no header."""
    return {"Authorization": f"Bearer {bearer}"} if bearer else {}


def _is_code_shaped(code: str) -> bool:
    """Whether a lower-case code has the shape a prompt may carry."""
    return bool(_LANGUAGE_CODE_PATTERN.match(code))


# The script names the TranslateGemma prompt uses (deployed _SCRIPT_NAMES).
# A script that is not listed is named by its code, which is still an
# unambiguous script tag.
_SCRIPT_NAMES = {
    "Latn": "Latin",
    "Arab": "Arabic",
    "Beng": "Bengali",
    "Cyrl": "Cyrillic",
    "Deva": "Devanagari",
    "Ethi": "Ethiopic",
    "Guru": "Gurmukhi",
    "Hans": "Han",
    "Hant": "Han",
    "Hang": "Hangul",
    "Jpan": "Japanese",
    "Mlym": "Malayalam",
    "Thai": "Thai",
}


class TranslationClient:
    """The async translation client the preparer drives.

    The registry, the endpoint cache and the transport are constructor-
    injected; ``create()`` assembles the default wiring from the config.
    """

    def __init__(
        self,
        config: PreparationConfig,
        registry,
        transport: TranslationTransport,
        cache: ModelEndpointCache | None = None,
    ):
        self._config = config
        self._registry = registry
        self._transport = transport
        self._cache = cache or ModelEndpointCache(
            config.translation_endpoint, self._transport, config.probe_timeout_seconds, config.detect_ttl_seconds
        )
        # Permanent negative cache of the /tokenize count (deployed
        # _TRANSLATION_COUNT_UNAVAILABLE): latched once the server REJECTS the
        # count with a client-error status. Transient failures do NOT latch.
        self._count_unavailable = False

    # --- discovery ---

    async def translation_window(self) -> int | None:
        """The discovered translation-model window in tokens, or None."""
        return await self._cache.max_model_len(self._config)

    async def translation_model_id(self) -> str | None:
        """The model id: the explicit env when set, else the discovered one.

        None is a valid state: the generic path sends no model name; only the
        TranslateGemma completions payload needs one.
        """
        if self._config.model_id:
            return self._config.model_id
        return await self._cache.model_id(self._config)

    @staticmethod
    def is_translategemma(model_id: str | None) -> bool:
        """True when the active translation model is TranslateGemma.

        Callers pass the id they already resolved, so one read decides the
        payload AND the response parse (a second read would re-probe and
        could disagree). A non-string id (a proxy answering a scalar) is
        not a TranslateGemma id: the generic path runs, and no AttributeError
        escapes the preparation — a degraded discovery must degrade, never
        crash the caller.
        """
        return isinstance(model_id, str) and "translategemma" in model_id.lower()

    # --- the budget ---

    def _base_cap(self, text: str) -> int:
        """Degraded completion cap: roughly half the input, 512 floor,
        ceiling bound (deployed _translation_base_cap)."""
        return min(max(len(text) // 2, 512), self._config.completion_base_ceiling)

    async def _count_tokens(self, count_body: dict) -> int | None:
        """Count the prompt tokens with the translation server's own tokenizer.

        A client's char/token ratio is a guess (dense scripts run ~1 token/char,
        Latin ~4), so the MEASURED count is what sizes the completion cap.
        Best-effort by contract: None comes back when the server cannot count
        and the caller sizes the completion with the degraded estimate — a
        count failure never stops a translation.
        """
        if self._count_unavailable:
            return None
        api_key = self._config.bearer or ""
        headers = _auth_headers(api_key)
        url = f"{self._config.translation_endpoint}/tokenize"
        try:
            status, payload = await self._transport.post_json(
                url, headers, dict(count_body), self._config.probe_timeout_seconds
            )
        except Exception as e:  # noqa: BLE001 — the count is best-effort
            logger.debug("Translation prompt could not be counted (%s: %s)", type(e).__name__, e)
            return None
        if status >= 400:
            if 400 <= status < 500 and status != 429:
                # A client-error status is a permanent capability gap (no
                # route, or a route that rejects this payload shape): the
                # count is not attempted again. Rate limiting is transient,
                # and so is everything at 500 or above.
                self._count_unavailable = True
                logger.warning(
                    "Translation server rejected the prompt count (%s); "
                    "the completion falls back to the degraded estimate.",
                    status,
                )
            else:
                logger.debug("Translation prompt could not be counted (answered %s)", status)
            return None
        try:
            return self._parse_tokenize_count(payload)
        except Exception as e:  # noqa: BLE001
            logger.debug("Translation prompt could not be counted (%s: %s)", type(e).__name__, e)
            return None

    @staticmethod
    def _parse_tokenize_count(payload) -> int:
        """The token count out of a ``/tokenize`` payload — the module-level
        :func:`parse_tokenize_count`, kept as a method alias for the
        translation client's call sites."""
        return parse_tokenize_count(payload)

    async def completion_cap(self, prompt: str, count_body: dict, window: int | None) -> int:
        """The completion cap for one translation request.

        The cap is the room the window leaves beside the MEASURED prompt,
        bounded by what the translation needs (4x the prompt tokens plus a
        margin). Too little room refuses LOUD: the server would reject the
        request or cut the completion off. Without a measurable count the
        degraded estimate bounds the completion, clamped by the window.

        Raises:
            TranslationInputTooLongError: the prompt leaves too little room
            in the window for a translation.
        """
        if not window:
            return self._base_cap(prompt)
        prompt_tokens = await self._count_tokens(count_body)
        if prompt_tokens is None:
            # Degraded: the estimate bounds the completion, clamped by the
            # window so the request cannot overflow it.
            return min(self._base_cap(prompt), max(1, window - self._config.completion_safety_tokens))
        room = window - prompt_tokens - self._config.completion_safety_tokens
        if room < self._config.completion_min_room:
            raise TranslationInputTooLongError(
                f"translation prompt ({prompt_tokens} tokens) leaves {room} of {window} tokens, "
                "too little for a translation"
            )
        needed = self._config.completion_needed_multiplier * prompt_tokens + self._config.completion_needed_margin
        return min(room, needed)

    # --- prompts ---

    def build_translategemma_prompt(self, text: str, source_lang_code: str, target_lang_code: str) -> str:
        """The TranslateGemma prompt (deployed ``_build_translategemma_prompt``).

        The language names and the scripts come from the registry, so nothing
        that is not a language reaches the prompt. A code the map does not
        know is not a language: the target falls back to English, and the
        SOURCE is not named at all — the prompt then asks for a translation
        into the target without claiming to know what the source is. That is
        the case the history hits when the detector answers with a code the
        map does not key (``zh-cn``): the history is still normalized to
        English, but no raw code is written into the prompt.
        """
        language_codes = self._registry.language_codes()
        scripts = self._registry.language_scripts()

        target_code = str(target_lang_code).strip().lower()
        if not _is_code_shaped(target_code) or target_code not in language_codes:
            logger.warning(f"Target language '{target_lang_code}' is not a known language — using English.")
            target_code = "en"
        target_name = language_codes[target_code]

        # The source is named only when the map knows it. A code the map does
        # not key is not a language the service knows, and naming it would put
        # a raw code where a language belongs.
        source_code = str(source_lang_code).strip().lower()
        source_name = None
        if not _is_code_shaped(source_code):
            logger.warning(f"Source language '{source_lang_code}' is not a language code — not naming a source.")
        elif source_code not in language_codes:
            logger.warning(f"Source language '{source_lang_code}' is not in the language map — not naming a source.")
        else:
            source_name = language_codes[source_code]

        target_script = scripts.get(target_code)
        source_script = scripts.get(source_code) if source_name else None
        script_clause = ""
        if target_script == "Latn":
            script_clause = "Write the translation in the Latin alphabet only, and do not use any other script. "
        elif target_script:
            script_clause = (
                f"Write the translation in {target_name}, "
                f"using the {_SCRIPT_NAMES.get(target_script, target_script)} script. "
            )
        if source_script and source_script != "Latn" and source_script != target_script:
            script_clause += (
                f"Do not reproduce the source text in the {_SCRIPT_NAMES.get(source_script, source_script)} script. "
            )

        if source_name:
            role = f"a professional {source_name} ({source_code}) to {target_name} ({target_code}) translator"
            source_text = f"the original {source_name} text"
            not_output = f"Do NOT output in {source_name} or in any other language."
            request = f"Please translate the following {source_name} text into {target_name}"
        else:
            role = f"a professional translator into {target_name} ({target_code})"
            source_text = "the original text"
            not_output = "Do NOT output in any other language."
            request = f"Please translate the following text into {target_name}"

        return (
            f"<bos><start_of_turn>user\n"
            f"You are {role}. Your goal is to "
            f"accurately convey the meaning and nuances of {source_text} "
            f"while adhering to {target_name} grammar, vocabulary, and cultural "
            f"sensitivities.\n"
            f"CRITICAL: You MUST output ONLY in {target_name} ({target_code}). "
            f"{not_output} "
            f"{script_clause}\n"
            f"Produce only the {target_name} translation, without any additional "
            f"explanations or commentary. {request}:\n\n\n{text}"
            f"<end_of_turn>\n<start_of_turn>model\n"
        )

    def build_generic_chunk_prompt(self, text: str, canonical_code: str, target_name: str) -> str:
        """The generic single-message prompt (deployed ``_translate_chunk_in_language``)."""
        language_notes = {
            "Sesotho": "NOTE: Sesotho is spoken in Lesotho and South Africa. It is NOT Afrikaans.",
            "Bengali": "NOTE: Bengali is spoken in Bangladesh and India. It is NOT Hindi.",
            "Mandinka": "NOTE: Mandinka is spoken in West Africa (Gambia, Senegal, Mali).",
        }
        note = language_notes.get(target_name, "")
        return (
            f"Translate the following text to {target_name} "
            f"(ISO 639-1 code: {canonical_code}). {note} "
            f"Only output the translated text, nothing else."
            f"\n\nText: {text}\n\nTranslation:"
        )

    def build_generic_history_prompt(self, history_blob: str, target_name: str) -> str:
        """The generic history prompt (deployed list shape, :4222-4226)."""
        return (
            f"Translate the following chat history to {target_name}. "
            f"Preserve the role markers (e.g., 'USER:', 'ASSISTANT:')."
            f"\n\nHISTORY:\n{history_blob}"
        )

    # --- the seam ---

    async def translate_prompt(self, prompt: str, translategemma: bool, model_id: str | None) -> str:
        """Translate one prompt and return the NON-EMPTY translated text.

        The one seam behind both history shapes: the completion budget is
        measured against the window the translation model serves, the request
        goes out with that budget, and an empty or cut-off completion is a
        failure — so the budget, the request and the refusal live in one
        place. ``translategemma`` and ``model_id`` are the resolution the
        caller ALREADY made for its own prompt choice (deployed order: one
        read, passed down — a second read would re-probe, cost a failed
        probe per read on a down endpoint, and could disagree with the
        prompt the request carries).

        Raises:
            TranslationTimeoutError: the service did not answer in time.
            TranslationFailedError: the service failed, answered with an
                empty completion, or answered with a completion it cut off.
            TranslationInputTooLongError: the prompt does not fit the window.
        """
        # The caller's pair is trusted for every consistent caller; the
        # isinstance re-check only defends the inconsistent direct call
        # (translategemma=True, model_id=None) — that call degrades to the
        # generic path instead of posting a completions payload with a null
        # model. One source of truth for the flag stays in is_translategemma;
        # do not "simplify" this line away.
        translategemma_flag = translategemma and isinstance(model_id, str)
        payload, path, count_body = translation_payload(prompt, translategemma_flag, model_id)
        window = await self.translation_window()
        payload["max_tokens"] = await self.completion_cap(prompt, count_body, window)
        url = f"{self._config.translation_endpoint}{path}"
        headers = _auth_headers(self._config.bearer)
        try:
            status, body = await self._transport.post_json(url, headers, payload, self._config.service_timeout_seconds)
            if status >= 400:
                raise _ResponseStatusError(status, body)
            choices = (body if isinstance(body, dict) else {}).get("choices") or []
            if not choices:
                raise ValueError("the translation response carries no choice")
            choice = choices[0]
            content = _choice_content(choice, translategemma_flag)
        except Exception as e:
            raise classify_transport_error(e) from e

        if _completion_truncated(choice):
            logger.error("Translation model hit max_tokens; treating the translation as failed.")
            raise TranslationFailedError("translation model hit max_tokens: the translation is cut off")
        if not content:
            logger.error("Translation model returned an empty translation.")
            raise TranslationFailedError("translation model returned an empty translation")
        return content
