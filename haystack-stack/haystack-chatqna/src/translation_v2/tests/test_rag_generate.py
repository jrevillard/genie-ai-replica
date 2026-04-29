"""Tests for PDFQueryPipeline — strategy selection, post-process, QE, retry."""
from __future__ import annotations

import pytest

from translation_v2.interfaces import Chunk, QEResult
from translation_v2.rag.generate import (
    AnswerStrategy,
    PDFQueryPipeline,
    build_rag_prompts,
)


def _ch(text: str, page: int = 0, doc_id: str = "d") -> Chunk:
    return Chunk(text=text, doc_id=doc_id, page=page, metadata={"start_char": 0})


class FakeRetriever:
    def __init__(self, chunks=None):
        self._chunks = chunks or [_ch("Context text about metformin.", page=1)]
        self.calls = []

    async def retrieve(self, query, k=5):
        self.calls.append((query, k))
        return [(c, 0.9) for c in self._chunks[:k]]


class FakeGenerator:
    def __init__(self, reply: str = "answer", log: list | None = None):
        self._reply = reply
        self.calls = log if log is not None else []

    async def answer(self, system_prompt, user_prompt):
        self.calls.append((system_prompt, user_prompt))
        return self._reply


class FakeTranslator:
    def __init__(self, reply: str = "translated"):
        self._reply = reply
        self.calls = []

    async def translate(self, text, source, target, **kwargs):
        self.calls.append((text, source, target))
        return self._reply


class TestPromptConstruction:
    def test_system_includes_language(self):
        sys_p, _ = build_rag_prompts("q", [_ch("ctx")], answer_lang="en")
        assert "English" in sys_p

    def test_user_includes_question_and_context(self):
        _, user = build_rag_prompts("my question", [_ch("ctx content", page=3)], answer_lang="en")
        assert "my question" in user
        assert "ctx content" in user

    def test_empty_context_handled(self):
        _, user = build_rag_prompts("q", [], answer_lang="en")
        assert "no context" in user.lower()

    def test_citation_markers_in_user_prompt(self):
        _, user = build_rag_prompts("q", [_ch("c1", page=1), _ch("c2", page=2)], answer_lang="en")
        assert "[1]" in user
        assert "[2]" in user


class TestAnswerThenTranslate:
    @pytest.mark.asyncio
    async def test_calls_generator_then_translator(self):
        gen = FakeGenerator("English answer")
        tr = FakeTranslator("Mandinka answer")
        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(), generator=gen, translator=tr,
        )
        result = await pipe.answer("hello", target="ma")
        assert result["answer"] == "Mandinka answer"
        assert result["strategy"] == "answer_then_translate"
        assert len(gen.calls) == 1
        assert len(tr.calls) == 1
        # Generator was called with English-language prompt
        assert "English" in gen.calls[0][0]

    @pytest.mark.asyncio
    async def test_target_english_skips_translator(self):
        gen = FakeGenerator("English answer")
        tr = FakeTranslator("should-not-be-used")
        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(), generator=gen, translator=tr,
        )
        result = await pipe.answer("hi", target="en")
        assert result["answer"] == "English answer"
        assert tr.calls == []


class TestCrossLingualDirect:
    @pytest.mark.asyncio
    async def test_single_generator_call_in_target(self):
        gen = FakeGenerator("Mandinka output directly")
        tr = FakeTranslator("should-not-be-used")
        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(), generator=gen, translator=tr,
            default_strategy=AnswerStrategy.CROSS_LINGUAL_DIRECT,
        )
        result = await pipe.answer("hi", target="ma")
        assert result["answer"] == "Mandinka output directly"
        assert tr.calls == []
        # Generator was called with Mandinka-language prompt
        assert "Mandinka" in gen.calls[0][0]

    @pytest.mark.asyncio
    async def test_strategy_string_accepted(self):
        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("x"),
            translator=FakeTranslator(),
        )
        r = await pipe.answer("q", strategy="cross_lingual_direct")
        assert r["strategy"] == "cross_lingual_direct"


class TestPostProcess:
    @pytest.mark.asyncio
    async def test_post_process_is_applied(self):
        seen = []

        def strip(text):
            seen.append(text)
            return text.strip().upper()

        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("  lowercase answer  "),
            translator=FakeTranslator("  lowercase answer  "),
            post_process=strip,
        )
        r = await pipe.answer("q", target="en")
        assert r["answer"] == "LOWERCASE ANSWER"


class TestQE:
    @pytest.mark.asyncio
    async def test_qe_runs_and_is_reported(self):
        class PassingQE:
            name = "pass"

            async def score(self, src, tgt, lang_pair=""):
                return QEResult(
                    score=0.8, metric=self.name, passed=True, threshold=0.5,
                )

        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("ok"),
            translator=FakeTranslator("ok"),
            qe=PassingQE(),
        )
        r = await pipe.answer("q", target="en")
        assert r["qe"]["passed"] is True
        assert r["qe"]["score"] == 0.8

    @pytest.mark.asyncio
    async def test_qe_raising_is_not_fatal(self):
        class BadQE:
            async def score(self, src, tgt, lang_pair=""):
                raise RuntimeError("boom")

        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("ok"),
            translator=FakeTranslator("ok"),
            qe=BadQE(),
        )
        r = await pipe.answer("q", target="en")
        assert r["qe"] is None


class TestRetryOnQEFail:
    @pytest.mark.asyncio
    async def test_cross_lingual_failure_retries_as_answer_then_translate(self):
        gen_calls: list = []
        tr_calls: list = []

        class FailThenPassQE:
            _count = 0

            async def score(self, src, tgt, lang_pair=""):
                self._count += 1
                return QEResult(
                    score=0.2 if self._count == 1 else 0.9,
                    metric="test",
                    passed=self._count > 1,
                    threshold=0.5,
                )

        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("x", log=gen_calls),
            translator=FakeTranslator("final"),
            qe=FailThenPassQE(),
            default_strategy=AnswerStrategy.CROSS_LINGUAL_DIRECT,
        )
        r = await pipe.answer("q", target="ma")
        assert r["retried"] is True
        assert r["strategy"] == "answer_then_translate"
        assert r["qe"]["passed"] is True

    @pytest.mark.asyncio
    async def test_no_retry_when_strategy_is_answer_then_translate(self):
        class AlwaysFailQE:
            async def score(self, src, tgt, lang_pair=""):
                return QEResult(score=0.0, metric="always_fail", passed=False, threshold=0.5)

        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(),
            generator=FakeGenerator("x"),
            translator=FakeTranslator("final"),
            qe=AlwaysFailQE(),
        )
        r = await pipe.answer("q", target="ma")
        # Default strategy is answer_then_translate — retrying with the same strategy would be pointless.
        assert r["retried"] is False


class TestCitations:
    @pytest.mark.asyncio
    async def test_citations_include_page_and_score(self):
        chunks = [_ch("a", page=1, doc_id="D1"), _ch("b", page=2, doc_id="D1")]
        pipe = PDFQueryPipeline(
            retriever=FakeRetriever(chunks=chunks),
            generator=FakeGenerator("done"),
            translator=FakeTranslator("done"),
        )
        r = await pipe.answer("q", target="en", k=2)
        assert len(r["citations"]) == 2
        assert r["citations"][0]["page"] == 1
        assert r["citations"][0]["doc_id"] == "D1"
        assert "score" in r["citations"][0]
        assert "excerpt" in r["citations"][0]
