# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The preparation entry: one path serving initial and refined queries.

The orchestrator of the recorded §5.1 order (V02
``docs/baselines/v02-opea-query-path-contract.md`` §5.1), ported from
``genieai_chatqna.py:4578-4806``:

1. the caller names a language or names none — a named code is resolved
   against the registry (trim, cut to 32, lowercase, map lookup, UPPERCASE);
   a code the map does not know behaves as "nothing named" (the BFF refuses
   unknown codes with HTTP 400 before the agent path — the deployed
   language_refused branch is unreachable here, and no separate branch is
   built);
2. when nothing usable is named, the last user message is detected
   (langdetect, crash → no detection);
3. the detected code becomes the HISTORY language whether or not the
   translation models cover it (``detected or named``); a code the map does
   not key still names the source — the TranslateGemma prompt omits the
   source name, and the history is translated to English regardless. The
   deployed ``is_supported`` gate steers only the ANSWER and is NOT ported
   (answer language is BFF-owned);
4. when the history language is not ``EN``, the history is translated to
   English (the target is the language of the embedding space, never the
   language the caller asked the answer in);
5. the last ``USER:`` segment of the TRANSLATED history becomes the
   retrieval query (the whole blob as the fallback when the marker is
   absent).

The three failure classes keep their distinct outcomes (V02 §5.4, mapped
onto the capability contract's taxonomy — see the Design Notes of the
story): an oversized input RAISES the typed
:class:`~preparation.translation.TranslationInputTooLongError` (the
abstention class — never an untranslated fallback), while an unavailable or
blank translation RETURNS an unprepared result carrying
``fallback_timeout`` / ``fallback_error`` — the caller answers with
degradation, and never receives a source-language query dressed as prepared.
``asyncio.CancelledError`` propagates untouched: it is never caught and
never mapped to any status.
"""

import logging
from dataclasses import dataclass

import tracing
from capabilities.contract import PreparedQuery, QueryPreparationStatus

from . import bounds
from .config import HISTORY_TRANSLATION_TARGET, PreparationConfig
from .detection import detect_language, resolve_named_language
from .registry import LanguageRegistry
from .translation import (
    TranslationClient,
    TranslationFailedError,
    TranslationInputTooLongError,
    TranslationTimeoutError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PreparationResult:
    """What preparation produced for one query.

    ``query`` carries the :class:`~capabilities.contract.PreparedQuery` when
    — and only when — the preparation status is a prepared one; the port
    refuses everything else. ``history_text`` is the text the status speaks
    about: the English-normalized (translated or passthrough) history when
    prepared, the SOURCE text under an explicit fallback status otherwise —
    never a source text under a prepared status — and the empty string for
    an empty history. ``language`` is the resolved history language (the
    upper-case canonical code), None when neither detection nor the caller
    established one.
    """

    status: QueryPreparationStatus
    query: PreparedQuery | None
    history_text: str
    language: str | None

    @property
    def prepared(self) -> bool:
        """Whether the query is ready to hand to the port."""
        return self.query is not None


class QueryPreparer:
    """The preparation module the loop (and config B) drives.

    The translator, the registry and the config are constructor-injected;
    ``create()`` assembles the default wiring from the environment. One
    instance serves the whole process: the translator owns the TTL-cached
    endpoint probe, the registry owns the read-once file cache.
    """

    def __init__(
        self,
        config: PreparationConfig,
        registry: LanguageRegistry,
        translator: TranslationClient,
        default_source_language: str | None = None,
    ):
        self._config = config
        self._registry = registry
        self._translator = translator
        # The caller's default for "nothing named": the language the
        # surrounding conversation is in (the deployed semantics — a named
        # language beats detection). An explicit per-call
        # ``source_language`` still wins; None keeps the old behavior
        # (detection decides when nothing is named anywhere).
        self._default_source_language = default_source_language

    @classmethod
    def create(cls, env=None) -> "QueryPreparer":
        """Assemble the default wiring from the environment."""
        config = PreparationConfig.load(env)
        registry = LanguageRegistry(config.registry_path)
        translator = TranslationClient(config, registry)
        return cls(config, registry, translator)

    async def prepare(self, history: list | str, source_language=None) -> PreparationResult:
        """Prepare one query — the initial request's or a refined mid-loop
        query, identically.

        ``history`` is the conversation in either deployed shape: a message
        list (the deployed BFF shape — trims within the budget) or a plain
        string (the single-message shape — refuses when over the budget).
        ``source_language`` is the language the caller named, if any.

        Returns the :class:`PreparationResult`; raises
        :class:`~preparation.translation.TranslationInputTooLongError` when
        the input does not fit the translation budget or window.
        """
        with tracing.with_span("preparation.prepare") as span:
            result = await self._prepare(history, source_language or self._default_source_language)
            span.set_attribute("query_translation_status", result.status.value)
            return result

    async def _prepare(self, history: list | str, source_language) -> PreparationResult:
        language_codes = self._registry.language_codes()
        named = resolve_named_language(source_language, language_codes)
        # Detection runs only when nothing usable is named — the deployed
        # trigger (`language_refused or not original_language or blank`;
        # the refused leg is unreachable here, see the module docstring).
        detected = detect_language(history) if named is None else None
        # The detection's answer wins whenever there is one: it is what the
        # conversation is actually written in, and the history has to be
        # normalized to English for the English-only embedding space.
        history_language = detected or named
        # The character budget: derived from the discovered window, capped
        # by an explicit MAX_TRANSLATION_CHARS, or the configured fallback.
        budget = bounds.derived_char_budget(await self._translator.translation_window(), self._config)

        try:
            if history_language and history_language.strip() != "EN":
                history_text, status = await self._translate_history(history, history_language.lower(), budget)
            else:
                # A passthrough is only "English" when something actually
                # established English: the request named it, or detection
                # concluded it. A fabricated fallback — no language given
                # and none detected, a crashed detection — is reported as
                # unknown, so the runbook filter cannot mistake an
                # arbitrary-language query for an English one.
                english_established = detected == "EN" or named == "EN"
                history_text, status = self._passthrough(history, english_established, budget)
        except TranslationInputTooLongError as e:
            # The refusal boundary: the input does not fit the translation
            # budget or window. Fail loud with the same typed refusal in
            # either shape — an untranslated fallback would be embedded into
            # the English space and retrieve the wrong documents.
            logger.warning(f"Translation overflow at the preparation boundary: {type(e).__name__}: {str(e)[:200]}")
            raise

        query_text = bounds.extract_query(history_text)
        query = None
        if status.is_prepared:
            query = PreparedQuery(text=query_text, preparation_status=status)
        return PreparationResult(status=status, query=query, history_text=history_text, language=history_language)

    def _passthrough(
        self, history: list | str, english_established: bool, budget: int
    ) -> tuple[str, QueryPreparationStatus]:
        """The no-translation path: already English, or no source language.

        Same recipe and same budget as the translator's flatten, so the two
        differ only in the words — and the retriever sees the same turns of
        the conversation whichever language the query is written in.
        """
        status = (
            QueryPreparationStatus.PASSTHROUGH_ENGLISH
            if english_established
            else QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE
        )
        if isinstance(history, str):
            # The budget does not care about the language: an oversized
            # query gets the same refusal on the English path as the
            # translation path gives it.
            if not history.strip():
                # An established-English blank must not report the healthy
                # passthrough_english label. A blank with NO established
                # language keeps the documented passthrough_unknown_language.
                if english_established:
                    logger.warning("History translation asked for an empty message; reporting it as a fallback.")
                    status = QueryPreparationStatus.FALLBACK_ERROR
                return history, status
            bounds.refuse_oversized_query(history, budget, self._config.msg_overhead_chars)
            return history, status
        messages = bounds.select_history_within_budget(history, budget, "passthrough", self._config.msg_overhead_chars)
        # An all-blank history must not report the healthy passthrough_english
        # label the translation path answers with fallback_error for the
        # identical history. A history with NO established language keeps the
        # documented passthrough_unknown_language — already a degraded value
        # on the runbook filter.
        if english_established and bounds.all_messages_blank(messages):
            logger.warning("History translation asked for blank messages; reporting it as a fallback.")
            status = QueryPreparationStatus.FALLBACK_ERROR
        return bounds.flatten_history(messages), status

    async def _translate_history(
        self, history: list | str, source_lang_code: str, budget: int
    ) -> tuple[str, QueryPreparationStatus]:
        """Translate the history to English; return ``(history_text, status)``.

        The bounds run FIRST — the oversized single-message refusal precedes
        the language map, so the refusal never depends on registry health.
        A history whose newest message alone exceeds the whole char budget is
        no exception (list shape): the newest message's tail is kept,
        truncated to the budget. The only empty text is an empty history.
        A translation-window overflow is NOT a fallback, in either shape:
        the newest message in the history is still the retrieval query, so an
        untranslated fallback would be embedded into the English space and
        retrieve the wrong documents — the typed refusal propagates instead.
        """
        if isinstance(history, str):
            if not history.strip():
                # An empty prompt would only harvest the model's junk reply
                # as the embedded query, and there is nothing to translate.
                logger.warning("History translation asked for an empty message; reporting it as a fallback.")
                return history, QueryPreparationStatus.FALLBACK_ERROR
            bounds.refuse_oversized_query(history, budget, self._config.msg_overhead_chars)
            flattened = history
        else:
            messages = bounds.select_history_within_budget(
                history, budget, "translation", self._config.msg_overhead_chars
            )
            if not messages:
                # An empty history: nothing to translate, nothing to keep —
                # the caller's regex finds no user message in an empty blob.
                return "", QueryPreparationStatus.FALLBACK_ERROR
            flattened = bounds.flatten_history(messages)
            if bounds.all_messages_blank(messages):
                # A history of blank messages would only harvest the model's
                # junk reply as the embedded query, and there is no content
                # to translate. The flattened string alone cannot be checked:
                # the role prefixes make it non-blank even when every message
                # is blank.
                logger.warning("History translation asked for blank messages; reporting it as a fallback.")
                return flattened, QueryPreparationStatus.FALLBACK_ERROR

        # The target steers the prompt, so it is resolved against the language
        # map — ONCE, for both shapes of the history. The target is English:
        # the history is normalized to the language of the embedding space,
        # not to the language the caller asked for.
        target_name = self._registry.language_codes().get(HISTORY_TRANSLATION_TARGET)
        if target_name is None:
            logger.warning("The language map does not know English — refusing to translate the history.")
            return flattened, QueryPreparationStatus.FALLBACK_ERROR

        # One derivation per call: the prompt choice, the payload, the
        # endpoint path and the response parse must branch on the SAME
        # decision (and the same id) — the id is resolved ONCE here and
        # passed down (deployed order; a second read would re-probe and
        # could disagree, and a down endpoint would pay one failed probe
        # per read).
        model_id = await self._translator.translation_model_id()
        translategemma = self._translator.is_translategemma(model_id)
        if translategemma:
            prompt = self._translator.build_translategemma_prompt(
                text=flattened, source_lang_code=source_lang_code, target_lang_code=HISTORY_TRANSLATION_TARGET
            )
        elif isinstance(history, str):
            # The single-message string IS the retrieval query, so the
            # generic path uses the chunk prompt.
            prompt = self._translator.build_generic_chunk_prompt(flattened, HISTORY_TRANSLATION_TARGET, target_name)
        else:
            prompt = self._translator.build_generic_history_prompt(flattened, target_name)

        try:
            translated = await self._translator.translate_prompt(prompt, translategemma, model_id)
        except TranslationTimeoutError as e:
            logger.warning(f"History translation timed out: {e}")
            return flattened, QueryPreparationStatus.FALLBACK_TIMEOUT
        except TranslationFailedError as e:
            logger.error(f"History translation failed: {e}")
            return flattened, QueryPreparationStatus.FALLBACK_ERROR
        return translated, QueryPreparationStatus.TRANSLATED
