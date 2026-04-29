"""PDF Q&A generation pipeline.

Two strategies:
  - ANSWER_THEN_TRANSLATE (default): generate an English answer
    grounded in the retrieved English context, then translate to the
    target language. Preserves factual accuracy best — the dominant
    requirement for clinical content.
  - CROSS_LINGUAL_DIRECT: the LLM answers directly in the target
    language from English context. Fewer steps, slight fidelity risk.
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any

from translation_v2.interfaces import Chunk, QEResult
from translation_v2.prompts import LANG_NAMES

logger = logging.getLogger(__name__)


class AnswerStrategy(str, Enum):
    ANSWER_THEN_TRANSLATE = "answer_then_translate"
    CROSS_LINGUAL_DIRECT = "cross_lingual_direct"


# ── Prompt construction ──────────────────────────────────────────────
_RAG_SYSTEM_TEMPLATE = """You are a careful clinical assistant answering questions from a provided PDF context, for a rural Gambian patient and their caregiver.

Rules:
- Answer ONLY from the provided context. If the context does not contain the answer, say so in {answer_language}.
- Keep clinical terms simple.
- Preserve medication names, place names, Gambian food names, and numeric values exactly as in the source.
- Do NOT invent citations, dosages, or instructions.
- Write in {answer_language}. Do not switch languages.
- Be concise — 1-4 short sentences unless the user asked for detail."""


_RAG_USER_TEMPLATE = """Context:
{context}

Question: {question}

Answer (in {answer_language}):"""


def build_rag_prompts(
    question: str, chunks: list[Chunk], answer_lang: str
) -> tuple[str, str]:
    lang_name = LANG_NAMES.get(answer_lang, answer_lang)
    context = "\n\n".join(
        f"[{i + 1}] (page {ch.page if ch.page is not None else '?'}) {ch.text}"
        for i, ch in enumerate(chunks)
    )
    if not context:
        context = "(no context retrieved)"
    system_prompt = _RAG_SYSTEM_TEMPLATE.format(answer_language=lang_name)
    user_prompt = _RAG_USER_TEMPLATE.format(
        context=context, question=question, answer_language=lang_name
    )
    return system_prompt, user_prompt


# ── The pipeline ─────────────────────────────────────────────────────
class PDFQueryPipeline:
    """Compose retriever + LLM answerer + translator + QE + post-processor.

    The retriever must already be warm (its ``index_corpus`` has been
    called — typically right after ingestion).
    """

    def __init__(
        self,
        retriever: Any,
        generator: Any,            # LLMGenerator
        translator: Any,           # TranslationProvider (v2 router or provider)
        qe: Any | None = None,     # QualityEstimator
        post_process: Any | None = None,   # callable(str) -> str
        default_strategy: AnswerStrategy = AnswerStrategy.ANSWER_THEN_TRANSLATE,
    ) -> None:
        self.retriever = retriever
        self.generator = generator
        self.translator = translator
        self.qe = qe
        self.post_process = post_process
        self.default_strategy = default_strategy

    async def answer(
        self,
        question: str,
        target: str = "ma",
        k: int = 5,
        strategy: AnswerStrategy | str | None = None,
        retry_on_qe_fail: bool = True,
    ) -> dict:
        if isinstance(strategy, str) and strategy:
            try:
                strategy = AnswerStrategy(strategy)
            except ValueError:
                strategy = None
        strategy = strategy or self.default_strategy

        retrieval = await self.retriever.retrieve(question, k=k)
        context_chunks = [ch for (ch, _score) in retrieval]

        answer_text = await self._generate_for_strategy(
            question, context_chunks, strategy, target
        )
        if self.post_process is not None:
            answer_text = self.post_process(answer_text)

        qe_result = await self._run_qe(question, answer_text, target)

        retried = False
        if (
            retry_on_qe_fail
            and qe_result is not None
            and not qe_result.passed
            and strategy == AnswerStrategy.CROSS_LINGUAL_DIRECT
        ):
            # Retry with the safer "answer then translate" path
            retried = True
            strategy = AnswerStrategy.ANSWER_THEN_TRANSLATE
            answer_text = await self._generate_for_strategy(
                question, context_chunks, strategy, target
            )
            if self.post_process is not None:
                answer_text = self.post_process(answer_text)
            qe_result = await self._run_qe(question, answer_text, target)

        return {
            "answer": answer_text,
            "strategy": strategy.value,
            "target": target,
            "retried": retried,
            "citations": [
                {
                    "doc_id": ch.doc_id,
                    "page": ch.page,
                    "score": round(score, 4),
                    "excerpt": ch.text[:240],
                }
                for (ch, score) in retrieval
            ],
            "qe": _qe_to_dict(qe_result),
        }

    async def _generate_for_strategy(
        self,
        question: str,
        context_chunks: list[Chunk],
        strategy: AnswerStrategy,
        target: str,
    ) -> str:
        if strategy == AnswerStrategy.ANSWER_THEN_TRANSLATE:
            sys_prompt, user_prompt = build_rag_prompts(
                question, context_chunks, answer_lang="en"
            )
            en_answer = await self.generator.answer(sys_prompt, user_prompt)
            if target == "en":
                return en_answer
            return await self.translator.translate(en_answer, "en", target)

        if strategy == AnswerStrategy.CROSS_LINGUAL_DIRECT:
            sys_prompt, user_prompt = build_rag_prompts(
                question, context_chunks, answer_lang=target
            )
            return await self.generator.answer(sys_prompt, user_prompt)

        raise ValueError(f"Unknown AnswerStrategy: {strategy!r}")

    async def _run_qe(
        self, question: str, answer_text: str, target: str
    ) -> QEResult | None:
        if self.qe is None:
            return None
        try:
            return await self.qe.score(question, answer_text, lang_pair=f"en-{target}")
        except Exception:
            logger.exception("QE scorer raised; treating as unknown quality")
            return None


def _qe_to_dict(r: QEResult | None) -> dict | None:
    if r is None:
        return None
    return {
        "score": round(r.score, 4),
        "metric": r.metric,
        "passed": r.passed,
        "threshold": r.threshold,
        "notes": r.notes,
    }
