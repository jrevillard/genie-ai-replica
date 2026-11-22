# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Config B — the single-pass no-agent pipeline (story 1.9).

One run of :meth:`NoAgentPipeline.run` is ONE pass through the recorded
stage list — preparation → retrieval/reranking/selection (the
``search_knowledge`` capability, called DIRECTLY: config A, the deployed
path this mode is compared against, has no executor, and the capability's
own authorized-set check already refuses an empty set and validates graph
names) → context/prompt construction → one fixed generation stage →
checking/verdict/result assembly. No agent loop, no tool calls, no
multi-step reasoning.

Every run is admitted through the flock slot-pool lane; when all slots are
busy the run is refused with :class:`noagent.lane.LaneBusyError` before any
stage runs. ``asyncio.CancelledError`` propagates untouched everywhere —
no handler in this module catches it and none maps it to a status.

The verdict, as deployed:

* the recorded insufficiencies keep their reasons DISTINCT —
  ``no_documents_retrieved``, ``reranker_selected_nothing`` (both answer a
  generation WITH the abstention instructions and no documents),
  ``reranker_input_too_long`` (the fixed English abstention text IS the
  answer; NO generation call), and the pipeline's own honest
  ``preparation_degraded`` for an unprepared preparation result (no
  retrieval runs; the abstention instructions drive a generation without
  documents, and the exact ``query_translation_status`` rides the
  metadata — never a prepared label on source text);
* ``CHATQNA_ENFORCE_ABSTENTION`` (default true) gates both the instruction
  injection and the ``abstained`` flag — the same predicate on both, so a
  deployment that turned the guardrail off answers instead of abstaining;
* the answer translation is OFF by default
  (``AGENT_ANSWER_TRANSLATION_ENABLED``); when enabled it runs through
  :class:`AnswerTranslator` and its outcome rides ``translation_status``
  (``ok`` | ``refused`` | ``failed``), with refused/failed keeping the
  English answer in place.

The result type (:class:`NoAgentResult`) carries the answer, the
abstention flag and reason, the source-document envelope (the deployed
shape: legacy ``document_id`` without a marker; OKF trio with
``source: 'okf-concept'``) and the metadata payload the BFF forwards.
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import tracing

# The ``source_documents`` projection lives in capabilities.citations (the
# shared home both lanes import — the governed path projects its delivered
# citations onto the SAME envelope). The name is RE-EXPORTED here: the
# pipeline's own callers and suites import it from this module, and the
# output is byte-identical to the pre-extraction behavior.
from capabilities.citations import source_document_envelope
from capabilities.contract import (
    CallerContext,
    OperationBudget,
    OutcomeCode,
    PreparedQuery,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
)
from preparation import PreparationConfig, QueryPreparer
from preparation.registry import LanguageRegistry
from preparation.translation import HttpxTransport, ModelEndpointCache

from . import prompt as prompt_module
from .config import NoAgentConfig
from .generation import GenerationClient, TokenCounter, chat_choice, chat_choice_content
from .lane import AdmissionLane

logger = logging.getLogger(__name__)

# The pipeline's own honest degradation reason (NOT a recorded deployed
# reason — the deployed path embedded the source text instead; this pipeline
# refuses the mechanism and answers the degradation, per the story's Design
# Notes).
PREPARATION_DEGRADED = "preparation_degraded"

# The rank-decay confidence default (deployed CONFIDENCE_RANK_DECAY).
DEFAULT_CONFIDENCE_RANK_DECAY = 0.5

# The answer-translation budget's constants (deployed gpu-translate-backend:
# the prompt-offset tokens, the safety margin, the refusal floor and the
# need bound).
_TRANSLATION_PROMPT_OFFSET_TOKENS = 20
_TRANSLATION_INPUT_SAFETY_TOKENS = 128
_TRANSLATION_MIN_OUTPUT_BUDGET = 256
_TRANSLATION_CHARS_PER_TOKEN = 4


def _rank_weighted_confidence(scores: list[float], decay: float) -> float:
    """Exponential rank-decay weighted average of reranker scores (deployed
    ``_rank_weighted_confidence``): scores descend, rank 0 is the most
    relevant document, 0.0 for an empty list (ungrounded)."""
    if not scores:
        return 0.0
    effective = decay if decay >= 0 else DEFAULT_CONFIDENCE_RANK_DECAY
    weights = [math.exp(-effective * i) for i in range(len(scores))]
    return sum(w * s for w, s in zip(weights, scores, strict=True)) / sum(weights)


@dataclass(frozen=True)
class NoAgentResult:
    """What one no-agent turn produced (the BFF-forwardable shape)."""

    answer: str
    abstained: bool
    abstention_reason: str | None
    source_documents: tuple[dict, ...]
    metadata: dict[str, Any] = field(default_factory=dict)


class AnswerTranslator:
    """The gated answer-translation client (OFF by default).

    Its own small client over the same endpoint/prompt/budget patterns the
    history translation uses (:mod:`preparation.translation`) — the history
    translator hardcodes the English target (deployed parity: the embedding
    space); the answer targets the CALLER's language. The budget follows the
    deployed gpu-translate-backend: the input is estimated at 4 chars/token,
    the completion cap is the smaller of the window room (minus the 128
    safety tokens) and the need bound (4× the input + 256), and a prompt
    that leaves too little room fails the translation instead of asking for
    an unusable budget. A cut-off completion is a FAILURE, never a short
    answer.

    Outcomes: ``ok`` (the translated answer), ``refused`` (the requested
    language is not one the registry knows — the caller's mistake, the
    English answer stays), ``failed`` (the endpoint failed, answered
    nothing usable, or cut off — the English answer stays).
    """

    def __init__(self, config: NoAgentConfig, registry: LanguageRegistry, transport=None, cache=None):
        self._config = config
        self._registry = registry
        self._transport = transport or HttpxTransport(config.tls_verify)
        self._cache = cache or ModelEndpointCache(
            config.translation_endpoint, self._transport, config.probe_timeout_seconds, config.detect_ttl_seconds
        )

    async def translate(self, text: str, target_language: str) -> tuple[str, str]:
        """Translate ``text`` into ``target_language``; return ``(answer, status)``."""
        codes = self._registry.language_codes()
        code = str(target_language or "").strip().lower()
        target_name = codes.get(code)
        if not target_name:
            logger.warning(f"Answer translation refused: '{target_language}' is not a known language.")
            return text, "refused"
        model_id = self._config.translation_model_id or await self._cache.model_id(self._config)
        answer_prompt = (
            f"Translate the following text to {target_name} "
            f"(ISO 639-1 code: {code}). Only output the translated text, nothing else."
            f"\n\nText: {text}\n\nTranslation:"
        )
        window = await self._cache.max_model_len(self._config)
        payload = {
            "model": model_id,
            "messages": [{"role": "user", "content": answer_prompt}],
            "temperature": 0.3,
        }
        headers = {"Authorization": f"Bearer {self._config.bearer}"} if self._config.bearer else {}
        if window:
            # The offset mirrors the deployed gpu-translate-backend and is
            # added AFTER the estimate: offset tokens, not characters —
            # inside the division it would contribute only 5. It stays out
            # of the need bound too: the scaffolding around the prompt
            # produces no output, so it does not multiply into the cap.
            estimated_tokens = math.ceil(len(answer_prompt) / _TRANSLATION_CHARS_PER_TOKEN)
            input_tokens = estimated_tokens + _TRANSLATION_PROMPT_OFFSET_TOKENS
            room = window - input_tokens - _TRANSLATION_INPUT_SAFETY_TOKENS
            if room < _TRANSLATION_MIN_OUTPUT_BUDGET:
                logger.warning(f"Answer translation refused: the prompt leaves {room} of {window} tokens.")
                return text, "failed"
            payload["max_tokens"] = min(room, 4 * estimated_tokens + 256)
        try:
            status, body = await self._transport.post_json(
                f"{self._config.translation_endpoint}/v1/chat/completions",
                headers,
                payload,
                self._config.translation_timeout_seconds,
            )
        except Exception as e:  # noqa: BLE001 — every transport failure is a translation failure
            logger.warning(f"Answer translation failed: {type(e).__name__}: {str(e)[:200]}")
            return text, "failed"
        if status >= 400:
            logger.warning(f"Answer translation failed: the endpoint answered {status}.")
            return text, "failed"
        choice, finish_reason = chat_choice(body if isinstance(body, dict) else {})
        if choice is not None and finish_reason == "length":
            logger.warning("Answer translation was cut off at max_tokens; keeping the English answer.")
            return text, "failed"
        content = chat_choice_content(choice or {})
        if not isinstance(content, str) or not content.strip():
            logger.warning("Answer translation came back empty; keeping the English answer.")
            return text, "failed"
        return content.strip(), "ok"


class NoAgentPipeline:
    """Config B: one fixed pass per turn, under the lane."""

    def __init__(
        self,
        config: NoAgentConfig,
        preparer: QueryPreparer,
        capability,
        lane: AdmissionLane,
        generation: GenerationClient,
        counter: TokenCounter,
        budget: OperationBudget,
        translator: AnswerTranslator | None = None,
        score_calibrator=None,
    ):
        self._config = config
        self._preparer = preparer
        self._capability = capability
        self._lane = lane
        self._generation = generation
        self._counter = counter
        self._budget = budget
        self._translator = translator
        # The deployed confidence-time calibration (RERANKER_SCORE_CALIBRATION
        # on the reranking config the capability owns); None keeps the raw
        # score (the default `none` calibration).
        self._score_calibrator = score_calibrator
        # The static-token memo (deployed `_count_static_tokens`): the system
        # prompt is per-process invariant (override-or-default, at most two
        # texts), so its /tokenize count is paid once per text, not once per
        # turn. Writes are event-loop-serialized — no lock.
        self._static_counts: dict[str, int] = {}

    async def _static_token_count(self, text: str) -> int:
        """The memoized token count of a per-process-invariant prompt piece."""
        cached = self._static_counts.get(text)
        if cached is None:
            cached = await self._counter.count(text)
            self._static_counts[text] = cached
        return cached

    @classmethod
    def create(cls, config: NoAgentConfig, capability, budget: OperationBudget, env=None) -> "NoAgentPipeline":
        """Assemble the default wiring: the preparer over the same env, the
        generation client (whose transport the counter shares — one wiring
        change lands once), the lane over the config, the answer translator
        when the gate is on, and the score calibrator from the capability's
        public ``score_calibrator`` surface (the capability's reranking
        adapter is the single owner of the calibration knob — no second
        reader that could drift). The translator owns its registry instance
        (the same file, its own read-once cache) — the preparer's is private
        to the preparer."""
        preparer = QueryPreparer.create(env)
        generation = GenerationClient.create(config)
        counter = TokenCounter(config, generation.model_id, generation.transport)
        lane = AdmissionLane.from_config(config)
        translator = None
        if config.answer_translation_enabled:
            registry = LanguageRegistry(PreparationConfig.load(env).registry_path)
            translator = AnswerTranslator(config, registry)
        return cls(
            config, preparer, capability, lane, generation, counter, budget, translator, capability.score_calibrator
        )

    async def run(
        self,
        history: list | str,
        context: CallerContext,
        source_language=None,
        target_language=None,
        user_context: str = "",
    ) -> NoAgentResult:
        """One single-pass turn. The lane wraps EVERY stage: a saturated lane
        refuses before preparation touches anything."""
        async with self._lane.acquire():
            return await self._run(history, context, source_language, target_language, user_context)

    async def _run(self, history, context, source_language, target_language, user_context) -> NoAgentResult:
        with tracing.with_span("noagent.prepare") as span:
            preparation = await self._preparer.prepare(history, source_language)
            span.set_attribute("query_translation_status", preparation.status.value)

        instructions = prompt_module.abstention_instructions(self._config)
        query_text = ""
        documents: list[str] = []
        search_result: SearchKnowledgeResult | None = None
        abstained = False
        reason: str | None = None

        if preparation.prepared:
            query: PreparedQuery = preparation.query
            query_text = query.text
            sink_reasons: list[str] = []

            search_input = SearchKnowledgeInput(query=query)
            search_result = await self._capability.search_knowledge(
                context, search_input, self._budget, abstention_sink=sink_reasons.append
            )
            documents = [hit.text for hit in search_result.hits]
            if search_result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE:
                # The recorded reasons stay distinct: the sink carries the
                # exact one (no_documents_retrieved / reranker_input_too_long
                # / reranker_selected_nothing / result_budget_exhausted
                # / no_resolvable_candidates).
                abstained = instructions is not None
                reason = sink_reasons[0] if sink_reasons else None
                logger.warning(f"abstained.reason={reason}")
        else:
            # Unprepared preparation: a degradation, never confident data.
            # No retrieval runs — the port requires prepared English and the
            # pipeline refuses the mechanism that dressed source text as a
            # prepared query. The abstention instructions drive a generation
            # without documents.
            query_text = preparation.history_text
            abstained = instructions is not None
            reason = PREPARATION_DEGRADED
            logger.warning(f"abstained.reason={PREPARATION_DEGRADED} status={preparation.status.value}")

        too_long_answer = reason == "reranker_input_too_long"
        translation_status: str | None = None
        if too_long_answer:
            # The recorded answer: the fixed English text, NO generation call
            # and NO tokenizer interaction — the deployed path answers it with
            # zero LLM/tokenizer round-trips, so the truncation guard (whose
            # counter would hit the same endpoint family) is skipped too.
            # RECORDED DIVERGENCE (translation): the deployed non-streamed
            # path DOES translate this abstention text (`_finalize_llm_response`
            # runs it through the answer translator like any answer), and the
            # BFF's streaming layer hands it to the backend translation too.
            # Config B's experiment-gated answer translation deliberately does
            # NOT touch it — the gate exists to translate GENERATED answers,
            # and the recorded text is the pipeline's own fixed abstention, so
            # with the gate on and a non-EN target this turn answers English
            # where deployed config A answers translated. E01 counts the
            # delta; changing it is a recorded decision, not a silent one.
            answer = prompt_module.RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT
        else:
            knowledge_section = prompt_module.render_knowledge_section(query_text, documents, instructions)
            system = prompt_module.system_prompt(self._config, preparation.language)
            window = await self._generation.window_tokens()
            answer_tokens = prompt_module.answer_reserve(self._config)
            truncated_history, _kept, _dropped = await prompt_module.truncate_history(
                preparation.history_text,
                system_tokens=await self._static_token_count(system),
                knowledge_base_section=knowledge_section,
                user_context=user_context,
                answer_tokens=answer_tokens,
                window_tokens=window,
                count_tokens=self._counter.count,
            )
            user_content = prompt_module.build_user_content(user_context, truncated_history, knowledge_section)
            answer = await self._generation.generate(system, user_content)
            answer, translation_status = await self._maybe_translate(answer, target_language)
        return self._assemble(
            answer=answer,
            search_result=search_result,
            preparation=preparation,
            context=context,
            abstained=abstained,
            reason=reason,
            translation_status=translation_status,
            too_long_answer=too_long_answer,
        )

    async def _maybe_translate(self, answer: str, target_language) -> tuple[str, str | None]:
        """The gated answer translation. Off (or nothing asked for): the
        English answer, no status. The outcomes keep the deployed
        vocabulary: ok / refused / failed — refused and failed keep the
        English answer in place."""
        if not self._config.answer_translation_enabled:
            return answer, None
        if target_language in (None, "", "en", "auto"):
            return answer, None
        return await self._translator.translate(answer, target_language)

    def _assemble(
        self,
        *,
        answer: str,
        search_result: SearchKnowledgeResult | None,
        preparation,
        context: CallerContext,
        abstained: bool,
        reason: str | None,
        translation_status: str | None,
        too_long_answer: bool,
    ) -> NoAgentResult:
        hits = tuple(search_result.hits) if search_result else ()
        calibrate = self._score_calibrator
        envelope = source_document_envelope(hits, calibrate)
        # The confidence aggregate runs over the FULL hit list — duplicates
        # included (deployed M3: a duplicate's score counts while the entry
        # itself is not re-surfaced) — at confidence time, calibrated like the
        # envelope scores.
        scores = [calibrate(hit.score) if calibrate is not None else hit.score for hit in hits]
        confidence = _rank_weighted_confidence(scores, self._config.confidence_rank_decay)
        is_grounded = bool(hits) and not too_long_answer
        metadata: dict[str, Any] = {
            "source_documents": envelope,
            # The labels the retrieval filtered on (the request's narrowing —
            # empty when the query was unfiltered), so an operator sees the
            # scope behind an abstention.
            "filter_labels": list(context.requested_labels),
            "retrieval_confidence_score": round(confidence, 2),
            "confidence_score": round(confidence, 2),
            "is_grounded": is_grounded,
            "query_translation_status": preparation.status.value,
        }
        if abstained:
            metadata["abstained"] = True
            metadata["abstention_reason"] = reason
        if translation_status is not None:
            metadata["translation_status"] = translation_status
        return NoAgentResult(
            answer=answer,
            abstained=abstained,
            abstention_reason=reason,
            source_documents=tuple(envelope),
            metadata=metadata,
        )
