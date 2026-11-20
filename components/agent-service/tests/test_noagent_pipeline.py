# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Config B end to end over fakes — every matrix row (story 1.9).

The capability, the preparer, the generation client and the counter are
fakes; the lane is REAL (a per-test lock path), the prompt assembly is the
real module. The pins: one single pass (preparation once, port once,
generation at most once), the three recorded reasons distinct, the
too-long case answering without a generation call, the degraded
preparation answering a degradation, saturation refusing before any stage,
cancellation propagating with its slot released, and the metadata shape.
"""

import asyncio
import atexit
import os
import shutil
import tempfile

import pytest

from capabilities.contract import (
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OperationBudget,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    SearchHit,
    SearchKnowledgeResult,
)
from noagent.config import NoAgentConfig
from noagent.generation import GenerationTransientError
from noagent.lane import AdmissionLane, LaneBusyError
from noagent.pipeline import (
    PREPARATION_DEGRADED,
    NoAgentPipeline,
    NoAgentResult,
    source_document_envelope,
)
from noagent.prompt import DEFAULT_ABSTENTION_INSTRUCTIONS, RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT
from preparation.prepare import PreparationResult

BUDGET = OperationBudget(timeout_ms=5000, max_results=5, max_result_bytes=1_000_000)


def _context(labels=("L1",)):
    return CallerContext(user_id="u1", authorized_graph_names=("GRAPH",), requested_labels=tuple(labels))


class FakeCapability:
    """The port double: records the calls, carries the configured outcome."""

    def __init__(self, result=None, error=None, sink_reason=None):
        self.result = result
        self.error = error
        self.sink_reason = sink_reason
        self.calls = []

    async def search_knowledge(self, context, request, budget, abstention_sink=None):
        self.calls.append({"request": request, "budget": budget, "sink": abstention_sink})
        if self.error is not None:
            raise self.error
        if self.sink_reason is not None and abstention_sink is not None:
            abstention_sink(self.sink_reason)
        return self.result


class FakePreparer:
    """The preparation double: returns the configured result."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    async def prepare(self, history, source_language=None):
        self.calls.append((history, source_language))
        return self.result


class FakeGeneration:
    def __init__(self, answer="The generated answer.", error=None, window=8192):
        self.answer = answer
        self.error = error
        self.window = window
        self.calls = []

    async def generate(self, system, user):
        self.calls.append((system, user))
        if self.error is not None:
            raise self.error
        return self.answer

    async def window_tokens(self):
        return self.window

    async def model_id(self):
        return "served-model"


class FakeCounter:
    def __init__(self):
        self.calls = []

    async def count(self, text):
        self.calls.append(text)
        return max(1, len(text) // 10)


def _prepared(status=QueryPreparationStatus.PASSTHROUGH_ENGLISH, query_text="How does Geneva manage transport?"):
    return PreparationResult(
        status=status,
        query=PreparedQuery(text=query_text, preparation_status=status) if status.is_prepared else None,
        history_text="USER: " + (query_text or "Quelle est la politique ?"),
        language="EN" if status is QueryPreparationStatus.PASSTHROUGH_ENGLISH else "FR",
    )


def _search_result(outcome=OutcomeCode.SUCCESS, hits=None):
    hits = (
        hits
        if hits is not None
        else (
            SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="doc one", score=0.9),
            SearchHit(provenance=LegacyFileProvenance(file_id="f2"), text="doc two", score=0.6),
        )
    )
    return SearchKnowledgeResult(
        outcome=outcome, hits=hits, truncated=False, query_preparation_status=QueryPreparationStatus.TRANSLATED
    )


def _default_lane(slots: int = 2) -> AdmissionLane:
    """A per-call lane in its own temp directory: no fixed global path, so
    concurrent pytest processes (or a local run beside CI) never contend on
    the same slot files. The directory is removed at interpreter exit —
    no /tmp litter, no cross-run lock leakage."""
    directory = tempfile.mkdtemp(prefix="noagent-test-lane-")
    atexit.register(shutil.rmtree, directory, True)
    return AdmissionLane(slots, os.path.join(directory, "lane.lock"))


def _pipeline(
    config=None,
    capability=None,
    preparer=None,
    generation=None,
    counter=None,
    lane=None,
    translator=None,
    budget=BUDGET,
):
    config = config or NoAgentConfig.load(env={})
    counter = counter or FakeCounter()
    return NoAgentPipeline(
        config,
        preparer or FakePreparer(_prepared()),
        capability or FakeCapability(result=_search_result()),
        lane or _default_lane(),
        generation or FakeGeneration(),
        counter,
        budget,
        translator,
    )


# ---------------------------------------------------------------------
# The happy rows: prepared English and prepared translated
# ---------------------------------------------------------------------


def test_prepared_english_with_hits_answers_from_the_documents():
    pipeline = _pipeline(
        preparer=FakePreparer(_prepared(status=QueryPreparationStatus.PASSTHROUGH_ENGLISH)),
        capability=FakeCapability(result=_search_result()),
    )
    result = asyncio.run(pipeline.run(["USER: How does Geneva manage transport?"], _context()))
    assert isinstance(result, NoAgentResult)
    assert result.abstained is False
    assert result.abstention_reason is None
    assert result.answer == "The generated answer."
    # The documents reached the prompt as the recorded blocks.
    system, user = pipeline._generation.calls[0]
    assert "\n[Retrieved Document]: doc one" in user
    assert "\n[Retrieved Document]: doc two" in user
    assert DEFAULT_ABSTENTION_INSTRUCTIONS not in user
    # The metadata carries the deployed fields.
    assert result.metadata["query_translation_status"] == "passthrough_english"
    assert result.metadata["is_grounded"] is True
    assert result.metadata["filter_labels"] == ["L1"]
    assert "abstained" not in result.metadata
    assert len(result.source_documents) == 2


def test_prepared_translated_row_is_the_identical_flow():
    preparer = FakePreparer(_prepared(status=QueryPreparationStatus.TRANSLATED))
    pipeline = _pipeline(preparer=preparer)
    result = asyncio.run(pipeline.run(["USER: Bonjour"], _context(), source_language="fr"))
    assert result.metadata["query_translation_status"] == "translated"
    assert result.abstained is False
    assert preparer.calls == [(["USER: Bonjour"], "fr")]


def test_the_port_receives_the_prepared_query_and_the_budget():
    capability = FakeCapability(result=_search_result())
    pipeline = _pipeline(capability=capability)
    asyncio.run(pipeline.run(["USER: q"], _context()))
    call = capability.calls[0]
    assert call["request"].query.text == "How does Geneva manage transport?"
    assert call["request"].query.preparation_status is QueryPreparationStatus.PASSTHROUGH_ENGLISH
    assert call["budget"] is BUDGET
    assert callable(call["sink"])  # the per-run sink traveled with the call


def test_the_context_of_one_call_never_leaks_into_another():
    """The sink travels WITH the call: two concurrent runs cannot see each
    other's reasons (the capability's own concurrency contract)."""
    capability = FakeCapability(result=_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()))
    pipeline = _pipeline(capability=capability)

    async def scenario():
        return await asyncio.gather(
            pipeline.run(["USER: q1"], _context()),
            pipeline.run(["USER: q2"], _context()),
        )

    asyncio.run(scenario())
    assert capability.calls[0]["sink"] is not capability.calls[1]["sink"]


# ---------------------------------------------------------------------
# The three recorded abstentions, kept distinct
# ---------------------------------------------------------------------


def _insufficient_pipeline(sink_reason):
    config = NoAgentConfig.load(env={})
    preparer = FakePreparer(_prepared())
    capability = FakeCapability(
        result=_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()), sink_reason=sink_reason
    )
    generation = FakeGeneration()
    pipeline = _pipeline(config=config, capability=capability, preparer=preparer, generation=generation)
    return pipeline, generation, capability


def test_empty_retrieval_abstains_with_no_documents_retrieved():
    pipeline, generation, _cap = _insufficient_pipeline("no_documents_retrieved")
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.abstained is True
    assert result.abstention_reason == "no_documents_retrieved"
    assert result.metadata["abstained"] is True
    assert result.metadata["abstention_reason"] == "no_documents_retrieved"
    # The instructions were injected and generation ran WITHOUT documents.
    _system, user = generation.calls[0]
    assert DEFAULT_ABSTENTION_INSTRUCTIONS in user
    assert "[Retrieved Document]" not in user
    assert result.metadata["is_grounded"] is False


def test_reranker_selected_nothing_is_distinct_from_empty_retrieval():
    pipeline, generation, _cap = _insufficient_pipeline("reranker_selected_nothing")
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.abstention_reason == "reranker_selected_nothing"
    assert len(generation.calls) == 1  # a generation ran (with instructions, no docs)
    _system, user = generation.calls[0]
    assert DEFAULT_ABSTENTION_INSTRUCTIONS in user


def test_reranker_input_too_long_answers_the_fixed_text_without_generation():
    """The recorded case: the fixed English abstention text IS the answer and
    NO generation call is made."""
    pipeline, generation, _cap = _insufficient_pipeline("reranker_input_too_long")
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.abstention_reason == "reranker_input_too_long"
    assert result.answer == RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT
    assert generation.calls == []
    assert result.metadata["is_grounded"] is False


def test_result_budget_exhausted_rides_the_sink_too():
    pipeline, _generation, _cap = _insufficient_pipeline("result_budget_exhausted")
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.abstention_reason == "result_budget_exhausted"


# ---------------------------------------------------------------------
# The degraded preparation row
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "status",
    [
        QueryPreparationStatus.FALLBACK_TIMEOUT,
        QueryPreparationStatus.FALLBACK_ERROR,
        QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE,
    ],
)
def test_unprepared_preparation_answers_a_degradation_never_confident_data(status):
    preparer = FakePreparer(_prepared(status=status))
    capability = FakeCapability(result=_search_result())
    generation = FakeGeneration()
    pipeline = _pipeline(preparer=preparer, capability=capability, generation=generation)
    result = asyncio.run(pipeline.run(["USER: Source-language question"], _context()))
    # No retrieval ran, no port call was made.
    assert capability.calls == []
    # The abstention instructions drove a generation without documents.
    assert len(generation.calls) == 1
    _system, user = generation.calls[0]
    assert DEFAULT_ABSTENTION_INSTRUCTIONS in user
    assert "[Retrieved Document]" not in user
    assert result.abstained is True
    assert result.abstention_reason == PREPARATION_DEGRADED
    # The EXACT preparation status rides the metadata.
    assert result.metadata["query_translation_status"] == status.value
    assert result.metadata["is_grounded"] is False
    assert result.source_documents == ()


def test_translated_status_is_never_stamped_on_a_degraded_turn():
    preparer = FakePreparer(_prepared(status=QueryPreparationStatus.FALLBACK_TIMEOUT))
    pipeline = _pipeline(preparer=preparer)
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.metadata["query_translation_status"] == "fallback_timeout"
    assert result.metadata["query_translation_status"] != "translated"


# ---------------------------------------------------------------------
# The enforce flag
# ---------------------------------------------------------------------


def test_abstention_not_enforced_injects_nothing_and_flags_nothing():
    config = NoAgentConfig.load(env={"CHATQNA_ENFORCE_ABSTENTION": "false"})
    capability = FakeCapability(
        result=_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()), sink_reason="no_documents_retrieved"
    )
    generation = FakeGeneration()
    pipeline = _pipeline(config=config, capability=capability, generation=generation)
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.abstained is False
    assert result.abstention_reason == "no_documents_retrieved"  # the reason is KNOWN…
    assert "abstained" not in result.metadata  # …but the flag is not set (deployed semantics)
    _system, user = generation.calls[0]
    assert DEFAULT_ABSTENTION_INSTRUCTIONS not in user  # no injection


# ---------------------------------------------------------------------
# The lane: saturation and cancellation
# ---------------------------------------------------------------------


def test_lane_saturation_refuses_before_any_stage_runs(tmp_path):
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))
    preparer = FakePreparer(_prepared())
    capability = FakeCapability(result=_search_result())
    generation = FakeGeneration()
    pipeline = _pipeline(preparer=preparer, capability=capability, generation=generation, lane=lane)

    async def scenario():
        contexts = [lane.acquire() for _ in range(1)]
        for context in contexts:
            await context.__aenter__()
        with pytest.raises(LaneBusyError):
            await pipeline.run(["USER: q"], _context())
        await contexts[0].__aexit__(None, None, None)
        # The freed lane admits the run, which now goes through the stages.
        result = await pipeline.run(["USER: q"], _context())
        return result

    result = asyncio.run(scenario())
    assert preparer.calls == [(["USER: q"], None)]  # exactly one stage pass ran
    assert result.abstained is False


def test_cancellation_mid_generation_propagates_and_releases_the_slot(tmp_path):
    lane = AdmissionLane(1, str(tmp_path / "lane.lock"))

    class SlowGeneration(FakeGeneration):
        async def generate(self, system, user):
            await asyncio.sleep(10)

    pipeline = _pipeline(generation=SlowGeneration(), lane=lane)

    async def scenario():
        task = asyncio.ensure_future(pipeline.run(["USER: q"], _context()))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
            return "completed"
        except asyncio.CancelledError:
            return "cancelled"

    assert asyncio.run(scenario()) == "cancelled"
    # The slot was released: the successor runs.
    successor = _pipeline(generation=FakeGeneration(), lane=lane)
    result = asyncio.run(successor.run(["USER: q"], _context()))
    assert result.answer == "The generated answer."


# ---------------------------------------------------------------------
# The gated answer translation
# ---------------------------------------------------------------------


class FakeTranslator:
    def __init__(self, outcome=("translated answer", "ok")):
        self.outcome = outcome
        self.calls = []

    async def translate(self, text, target_language):
        self.calls.append((text, target_language))
        return self.outcome


def test_answer_translation_off_by_default_leaves_no_status():
    pipeline = _pipeline()
    result = asyncio.run(pipeline.run(["USER: q"], _context(), target_language="fr"))
    assert result.answer == "The generated answer."
    assert "translation_status" not in result.metadata


def test_answer_translation_gate_on_ok_status_and_translated_answer():
    translator = FakeTranslator(("réponse traduite", "ok"))
    config = NoAgentConfig.load(env={"AGENT_ANSWER_TRANSLATION_ENABLED": "true"})
    pipeline = _pipeline(config=config, translator=translator)
    result = asyncio.run(pipeline.run(["USER: q"], _context(), target_language="fr"))
    assert result.answer == "réponse traduite"
    assert result.metadata["translation_status"] == "ok"
    assert translator.calls == [("The generated answer.", "fr")]


def test_refused_or_failed_translation_keeps_the_english_answer():
    for outcome in (("The generated answer.", "refused"), ("The generated answer.", "failed")):
        translator = FakeTranslator(outcome)
        config = NoAgentConfig.load(env={"AGENT_ANSWER_TRANSLATION_ENABLED": "true"})
        pipeline = _pipeline(config=config, translator=translator)
        result = asyncio.run(pipeline.run(["USER: q"], _context(), target_language="de"))
        assert result.answer == "The generated answer."
        assert result.metadata["translation_status"] == outcome[1]


def test_no_translation_for_english_auto_or_nothing_even_when_gated():
    translator = FakeTranslator()
    config = NoAgentConfig.load(env={"AGENT_ANSWER_TRANSLATION_ENABLED": "true"})
    pipeline = _pipeline(config=config, translator=translator)
    for target in (None, "", "en", "auto"):
        result = asyncio.run(pipeline.run(["USER: q"], _context(), target_language=target))
        assert result.answer == "The generated answer."
        assert "translation_status" not in result.metadata
    assert translator.calls == []


# ---------------------------------------------------------------------
# The truncation guard through the pipeline, and the generation failure
# ---------------------------------------------------------------------


def test_history_over_the_window_drops_the_oldest_segments_keeps_the_documents():
    """The guard ran through the pipeline: the counter saw the history, the
    newest segment survived in the user content, the documents are whole."""
    config = NoAgentConfig.load(env={})
    generation = FakeGeneration(window=400)
    docs = ("doc one", "doc two")
    capability = FakeCapability(
        result=_search_result(
            hits=tuple(
                SearchHit(provenance=LegacyFileProvenance(file_id=f"f{i}"), text=d, score=0.9)
                for i, d in enumerate(docs)
            )
        )
    )
    old = "OLD" + "x" * 1000
    new = "NEW question"
    history = f"USER: {old} |<-MSG->| USER: {new}"
    preparer = FakePreparer(
        PreparationResult(
            status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
            query=PreparedQuery(text=new, preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH),
            history_text=history,
            language="EN",
        )
    )
    pipeline = _pipeline(config=config, capability=capability, preparer=preparer, generation=generation)
    result = asyncio.run(pipeline.run(["USER: q"], _context(labels=())))
    _system, user = generation.calls[0]
    assert old not in user  # the oldest segment was dropped
    assert new in user  # the newest survived
    assert "[Retrieved Document]: doc one" in user  # the documents were never truncated
    assert "[Retrieved Document]: doc two" in user
    assert result.metadata["filter_labels"] == []


def test_generation_endpoint_down_fails_the_turn_with_a_typed_error():
    generation = FakeGeneration(error=GenerationTransientError("endpoint down"))
    pipeline = _pipeline(generation=generation)
    with pytest.raises(GenerationTransientError, match="endpoint down"):
        asyncio.run(pipeline.run(["USER: q"], _context()))


# ---------------------------------------------------------------------
# The result assembly: the envelope, the confidence, the okf marker
# ---------------------------------------------------------------------


def test_source_document_envelope_legacy_and_okf_shapes():
    hits = (
        SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="t", score=0.9),
        SearchHit(
            provenance=OkfConceptProvenance(concept_id="c1", repo_id="repo-1", bundle_version=7), text="t", score=0.8
        ),
        SearchHit(
            provenance=OkfConceptProvenance(concept_id="c2", repo_id="repo-2", bundle_version=None), text="t", score=0.7
        ),
    )
    envelope = source_document_envelope(hits)
    legacy = envelope[0]
    assert legacy["document_id"] == "f1"
    assert "source" not in legacy  # the legacy branch: no marker
    assert legacy["categoryLabels"] == []
    okf = envelope[1]
    assert okf["source"] == "okf-concept"
    assert okf["concept_id"] == "c1"
    assert okf["repo_id"] == "repo-1"
    assert okf["bundle_version"] == 7
    okf_null_version = envelope[2]
    assert "bundle_version" not in okf_null_version  # a null version is ABSENT, not 0 (deployed rule)


def test_confidence_is_the_rank_weighted_average_and_zero_when_ungrounded():
    pipeline = _pipeline(capability=FakeCapability(result=_search_result()))
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    # decay 0.5: (0.9 + 0.6*e^-0.5) / (1 + e^-0.5) ≈ 0.79 — the strongest
    # match dominates the tail, that is the rank weighting.
    assert result.metadata["retrieval_confidence_score"] == pytest.approx(0.79, abs=0.01)
    assert result.metadata["confidence_score"] == result.metadata["retrieval_confidence_score"]
    empty = _pipeline(
        capability=FakeCapability(result=_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()))
    )
    empty_result = asyncio.run(empty.run(["USER: q"], _context()))
    assert empty_result.metadata["retrieval_confidence_score"] == 0.0


# ---------------------------------------------------------------------
# Review-round regressions: the too-long turn's zero-LLM shape, the
# duplicate-source rule and the confidence-time calibration
# ---------------------------------------------------------------------


def test_too_long_turn_answers_without_any_tokenizer_or_window_call():
    """The recorded answer with ZERO LLM/tokenizer interaction: the window
    probe and the truncation guard's counter would hit the same endpoint
    family the deployed too-long path never touches, so a /tokenize outage
    must not fail a turn whose answer is already fixed."""
    counter_calls = []

    class ExplodingCounter(FakeCounter):
        async def count(self, text):
            counter_calls.append(text)
            raise GenerationTransientError("tokenize down")

    class ExplodingWindow(FakeGeneration):
        async def window_tokens(self):
            raise GenerationTransientError("probe down")

    pipeline, generation, _cap = _insufficient_pipeline("reranker_input_too_long")
    pipeline._generation = ExplodingWindow()
    pipeline._counter = ExplodingCounter()
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.answer == RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT
    assert generation.calls == []
    assert counter_calls == []
    assert result.abstention_reason == "reranker_input_too_long"


def test_too_long_fixed_text_is_never_translated():
    """The gate translates GENERATED answers; the too-long case's answer is
    the recorded fixed English text — it stays English even with the gate
    on and a target asked."""
    translator = FakeTranslator(("réponse", "ok"))
    config = NoAgentConfig.load(env={"AGENT_ANSWER_TRANSLATION_ENABLED": "true"})
    pipeline, generation, _cap = _insufficient_pipeline("reranker_input_too_long")
    pipeline._translator = translator
    pipeline._config = config
    result = asyncio.run(pipeline.run(["USER: q"], _context(), target_language="fr"))
    assert result.answer == RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT
    assert translator.calls == []
    assert "translation_status" not in result.metadata


def test_duplicate_sources_surface_once_scores_count_all():
    """Deployed M3: the same document_id is surfaced once (first wins) while
    EVERY hit's score — duplicates included — feeds the confidence
    aggregate."""
    hits = (
        SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="chunk a", score=0.9),
        SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="chunk b", score=0.5),
        SearchHit(provenance=LegacyFileProvenance(file_id="f2"), text="chunk c", score=0.7),
    )
    pipeline = _pipeline(capability=FakeCapability(result=_search_result(hits=hits)))
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert [entry["document_id"] for entry in result.source_documents] == ["f1", "f2"]
    assert result.source_documents[0]["score"] == 0.9  # the first occurrence wins
    # (0.9 + 0.5*e^-0.5 + 0.7*e^-1) / (1 + e^-0.5 + e^-1) ≈ 0.7399 — all
    # three scores, duplicates included.
    assert result.metadata["retrieval_confidence_score"] == pytest.approx(0.7399, abs=0.01)


def test_score_calibrator_applies_at_confidence_time_only():
    """The deployed calibration rides the envelope scores AND the confidence
    aggregate; the raw scores the capability returned are not mutated."""

    def sigmoid(score):
        return 1 / (1 + pow(2.718281828459045, -score))

    hits = (
        SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="a", score=0.9),
        SearchHit(provenance=LegacyFileProvenance(file_id="f2"), text="b", score=0.6),
    )
    capability = FakeCapability(result=_search_result(hits=hits))
    pipeline = _pipeline(capability=capability)
    pipeline._score_calibrator = sigmoid
    result = asyncio.run(pipeline.run(["USER: q"], _context()))
    assert result.source_documents[0]["score"] == pytest.approx(sigmoid(0.9))
    assert result.source_documents[1]["score"] == pytest.approx(sigmoid(0.6))
    calibrated = [sigmoid(0.9), sigmoid(0.6)]
    expected = (calibrated[0] + calibrated[1] * pow(2.718281828459045, -0.5)) / (1 + pow(2.718281828459045, -0.5))
    assert result.metadata["retrieval_confidence_score"] == pytest.approx(expected, abs=0.01)
    # The hits themselves were never touched: calibration is confidence-time.
    assert capability.result.hits[0].score == 0.9
