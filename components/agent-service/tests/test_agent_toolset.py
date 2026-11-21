# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production toolset home and the preparation leg in the governed run.

Mutation-sensitive pins: the registered toolset lives in ``agent.toolset``
and the probe RE-IMPORTS it (the same function object — a move, not a
copy); the probe path (``preparer=None``) keeps the pre-move builder's
behavior except a missing or blank query, now refused before the port (a
valid query rides ``passthrough_english``); a wired preparer
feeds the PREPARED query to the port (never the raw text) and reports its
status; an unprepared preparation answers the contract's insufficiency
shape with the port UNTOUCHED; a translation overflow raises its typed
error into the honest run-error contract (never an untranslated fallback);
the budgeted translator claims one AUXILIARY model call per translation
dispatch BEFORE the request leaves, and a spent fleet budget refuses it
before any call.
"""

import asyncio

import pytest
from conftest import (
    ENDPOINT,
    AgentFakePort,
    PreparationFakeTransport,
    ScriptedLoopModel,
    canned_read_result,
    canned_search_result,
    multihop_turns,
    orchestrator_config,
    run_budget,
)

import agent.probe
import agent.toolset
from agent.budget import RunBudgetMonitor
from agent.events import AgentEvent
from agent.loop import ModelTurn
from agent.orchestrator import (
    AgentRunRequest,
    BudgetedTranslationClient,
    RequestOrchestrator,
    build_preparer_factory,
)
from agent.probe import PROBE_SYSTEM_PROMPT
from agent.prompt import PRODUCTION_SYSTEM_PROMPT
from agent.toolset import document_toolset
from capabilities.contract import CallerContext, PreparedQuery, QueryPreparationStatus
from noagent.lane import AdmissionLane
from preparation.config import PreparationConfig
from preparation.prepare import PreparationResult, QueryPreparer
from preparation.registry import LanguageRegistry
from preparation.translation import TranslationClient, TranslationInputTooLongError

CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))


class FakePreparer:
    """The preparation entry's double: a canned result per call, recorded."""

    def __init__(self, result):
        self.result = result
        self.calls: list = []

    async def prepare(self, text, source_language=None):
        self.calls.append(text)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _preparation_result(status, query_text=None):
    return PreparationResult(
        status=status,
        query=None if query_text is None else PreparedQuery(text=query_text, preparation_status=status),
        history_text=query_text or "the source text",
        language="FR",
    )


def _judge_turn():
    return ModelTurn(content='{"verdict": "grounded"}')


# ---------------------------------------------------------------------
# The toolset home: the registered toolset left the probe module
# ---------------------------------------------------------------------


def test_the_probe_reimports_the_moved_builder():
    assert agent.probe.document_toolset is agent.toolset.document_toolset
    # The probe module keeps its own prompt; the governed default is the
    # production one (the orchestrator's default, not the harness's).
    assert PROBE_SYSTEM_PROMPT != PRODUCTION_SYSTEM_PROMPT


def test_the_probe_path_is_unchanged_passthrough():
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_toolset(port, CONTEXT, orchestrator_config().operation_budget)
    assert registry.names() == ("search_knowledge", "read_source")

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))

    assert result["outcome"] == "success"
    # The model's valid query rides the passthrough status — no
    # preparation call, the pre-move probe builder's behavior.
    [call] = port.search_calls
    assert call["request"].query.text == "the model query"
    assert call["request"].query.preparation_status == QueryPreparationStatus.PASSTHROUGH_ENGLISH


# ---------------------------------------------------------------------
# The preparation leg: the prepared query feeds the search
# ---------------------------------------------------------------------


def test_a_wired_preparer_feeds_the_prepared_query_to_the_port():
    preparer = FakePreparer(_preparation_result(QueryPreparationStatus.TRANSLATED, "the english query"))
    statuses: list[str] = []
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_toolset(
        port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer, on_preparation_status=statuses.append
    )

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "la requête du modèle"}))

    assert result["outcome"] == "success"
    [call] = port.search_calls
    # The PREPARED query — never the model's raw text — reaches the port.
    assert call["request"].query.text == "the english query"
    assert call["request"].query.preparation_status == QueryPreparationStatus.TRANSLATED
    assert preparer.calls == ["la requête du modèle"]
    assert statuses == ["translated"]


def test_an_unprepared_preparation_answers_insufficiency_and_never_touches_the_port():
    preparer = FakePreparer(_preparation_result(QueryPreparationStatus.FALLBACK_TIMEOUT))
    statuses: list[str] = []
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_toolset(
        port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer, on_preparation_status=statuses.append
    )

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "la requête non traduite"}))

    # The contract's own insufficiency shape, the exact status carried:
    # no source-language query dressed as prepared, the port untouched.
    assert result == {
        "outcome": "insufficient_evidence",
        "hits": [],
        "truncated": False,
        "query_preparation_status": "fallback_timeout",
    }
    assert port.search_calls == []
    assert statuses == ["fallback_timeout"]


def test_a_translation_overflow_raises_the_typed_error_through_the_tool():
    preparer = FakePreparer(TranslationInputTooLongError("the query exceeds the translation budget"))
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_toolset(port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer)

    with pytest.raises(TranslationInputTooLongError):
        asyncio.run(registry.dispatch("search_knowledge", {"query": "trop long"}))
    assert port.search_calls == []


@pytest.mark.parametrize("preparer_wired", [False, True])
def test_a_missing_or_blank_query_is_the_same_structured_refusal_on_both_paths(preparer_wired):
    """A model argument the contract refuses (missing, None, blank) raises
    the pydantic ``ValidationError`` on BOTH paths — the loop feeds it back
    as the structured tool result — never a TypeError that would kill the
    run, and never a port call."""
    from pydantic import ValidationError

    port = AgentFakePort(search_result=canned_search_result())
    prepared = _preparation_result(QueryPreparationStatus.TRANSLATED, "unused")
    preparer = FakePreparer(prepared) if preparer_wired else None
    registry = document_toolset(port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer)

    for bad_arguments in ({}, {"query": None}, {"query": "   "}):
        with pytest.raises(ValidationError):
            asyncio.run(registry.dispatch("search_knowledge", bad_arguments))

    assert port.search_calls == []
    if preparer is not None:
        assert preparer.calls == []  # the refusal precedes preparation too


# ---------------------------------------------------------------------
# In the governed run: preparation status, usage record, honest overflow
# ---------------------------------------------------------------------


def _orchestrator(model, port, tmp_path, *, preparer_factory=None):
    return RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(tmp_path / "lane.lock")),
        model_client=model,
        port_factory=lambda context, bearer: port,
        preparer_factory=preparer_factory,
    )


def _request(**overrides):
    values = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT, "language": "fr"}
    return AgentRunRequest(**{**values, **overrides})


class RecordingTranslator(TranslationClient):
    """A real TranslationClient whose dispatch is canned and recorded: the
    observable of the bound default hint — a query the hint routes to
    translation REACHES translate_prompt (with no hint, detection would
    pass the English-looking query straight through)."""

    def __init__(self, config, registry):
        super().__init__(config, registry)
        self.prompts: list[str] = []

    async def translate_prompt(self, prompt: str, translategemma: bool, model_id: str | None) -> str:
        self.prompts.append(prompt)
        return "the english query"


def test_the_run_record_carries_language_and_the_first_preparation_status(tmp_path):
    env = {"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    config = PreparationConfig.load(env=env)
    registry = LanguageRegistry(config.registry_path)

    def factory(monitor, language=None):
        # The REAL factory shape: the shipped QueryPreparer carries the
        # request's locale as its default source language.
        return QueryPreparer(config, registry, RecordingTranslator(config, registry), default_source_language=language)

    translator = RecordingTranslator(config, registry)
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((*multihop_turns(answer="the answer"), _judge_turn())),
        port,
        tmp_path,
        preparer_factory=lambda monitor, language=None: QueryPreparer(
            config, registry, translator, default_source_language=language
        ),
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.outcome == "answered"
    assert record.language == "fr"  # the request's UI locale rides the record
    assert record.preparation_status == "translated"  # the FIRST query's status
    # The hint reached preparation THROUGH THE SHIPPED CODE: the English-
    # looking model query was routed to translation (detection bypassed),
    # and its translated text is what reached the port.
    assert len(translator.prompts) == 1
    assert port.search_calls[0]["request"].query.text == "the english query"
    assert port.search_calls[0]["request"].query.preparation_status == QueryPreparationStatus.TRANSLATED


def test_an_explicit_source_language_beats_the_bound_default():
    """The shipped binding's precedence: an explicit per-call
    ``source_language`` wins over the constructor's default — the deployed
    named-language semantics, one assertion at the public entry."""
    env = {"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    config = PreparationConfig.load(env=env)
    registry = LanguageRegistry(config.registry_path)
    translator = RecordingTranslator(config, registry)
    preparer = QueryPreparer(config, registry, translator, default_source_language="fr")

    result = asyncio.run(preparer.prepare("bonjour le monde", source_language="en"))

    # Explicit EN: passthrough, detection skipped, the translator untouched
    # — the default hint never overruled the caller.
    assert result.status == QueryPreparationStatus.PASSTHROUGH_ENGLISH
    assert translator.prompts == []


def test_a_run_without_a_preparer_factory_records_no_preparation_status(tmp_path):
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((*multihop_turns(answer="the answer"), _judge_turn())), port, tmp_path
    )

    record = asyncio.run(orchestrator.run(_request(language=None)))

    assert record.preparation_status is None
    assert record.language is None
    assert port.search_calls[0]["request"].query.preparation_status == QueryPreparationStatus.PASSTHROUGH_ENGLISH


def test_an_overflow_run_ends_honestly_never_untranslated(tmp_path):
    def factory(monitor, language=None):
        return FakePreparer(TranslationInputTooLongError("the query exceeds the translation budget"))

    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((*multihop_turns(answer="a fabricated answer"), _judge_turn())),
        port,
        tmp_path,
        preparer_factory=factory,
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    # The typed refusal is the honest run error — the drafted answer never
    # ships, and the port is never reached with unprepared text. The refusal
    # fires inside the loop's dispatch: the started event exists, no finish
    # answers it (the run ended), and the terminal is the run_error.
    assert record.outcome == "error"
    assert "TranslationInputTooLongError" in record.error
    assert [event.kind.value for event in events] == ["run_started", "tool_call_started", "run_error"]
    assert port.search_calls == []


def test_a_spent_fleet_budget_at_preparation_ends_the_run_budget_exhausted(tmp_path):
    """BudgetExhausted escaping an EXECUTOR takes the run-level catch (a
    different path from the loop's own pre-dispatch checks): a preparation
    translator claiming past the spent fleet budget ends the run with the
    honest budget_exhausted terminal — no drafted answer, no verdict."""
    from agent.budget import BudgetExhausted

    def factory(monitor, language=None):
        return FakePreparer(BudgetExhausted("model_calls", "the run's model-call budget is exhausted"))

    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((*multihop_turns(answer="a fabricated answer"), _judge_turn())),
        port,
        tmp_path,
        preparer_factory=factory,
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.outcome == "budget_exhausted"
    assert "model-call budget" in record.error
    assert [event.kind.value for event in events] == ["run_started", "tool_call_started", "run_error"]
    assert events[-1].payload["code"] == "budget_exhausted"
    assert port.search_calls == []
    assert "a fabricated answer" not in str(events)


# ---------------------------------------------------------------------
# The budgeted translator: the aux claim precedes every dispatch
# ---------------------------------------------------------------------


def _budgeted_translator(monitor, transport):
    config = PreparationConfig.load(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    )
    registry = LanguageRegistry(config.registry_path)
    return BudgetedTranslationClient(config, registry, monitor, transport=transport)


def test_every_translation_dispatch_claims_one_aux_call_first():
    monitor = RunBudgetMonitor(run_budget())
    transport = PreparationFakeTransport(
        responses={
            f"{ENDPOINT}/v1/chat/completions": (
                200,
                {"choices": [{"finish_reason": "stop", "message": {"content": "hello"}}]},
            )
        }
    )
    translator = _budgeted_translator(monitor, transport)

    translated = asyncio.run(translator.translate_prompt("bonjour", False, "test-model"))

    assert translated == "hello"
    # The claim: one AUXILIARY model call on the fleet budget — counted
    # before the request left (the transport recorded the completions POST).
    assert monitor.aux_model_calls == 1
    assert monitor.model_calls == 1
    assert any(call["url"].endswith("/v1/chat/completions") for call in transport.calls)


def test_a_spent_fleet_budget_refuses_the_translation_before_any_call():
    monitor = RunBudgetMonitor(run_budget(max_model_calls=1))
    monitor.take_model_call()  # the loop spent the fleet budget
    transport = PreparationFakeTransport()
    translator = _budgeted_translator(monitor, transport)

    with pytest.raises(Exception, match="model-call budget"):
        asyncio.run(translator.translate_prompt("bonjour", False, "test-model"))

    assert monitor.aux_model_calls == 0  # nothing was claimed past the budget
    assert transport.calls == []  # no request left


# ---------------------------------------------------------------------
# The preparer factory: one preparer per run
# ---------------------------------------------------------------------


def test_the_factory_builds_one_preparer_per_run():
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    )
    first = factory(RunBudgetMonitor(run_budget()))
    second = factory(RunBudgetMonitor(run_budget()))

    assert isinstance(first, QueryPreparer)
    assert isinstance(second, QueryPreparer)
    assert first is not second  # one preparer PER RUN, over the shared wiring


def test_the_real_factory_counts_the_preparation_translation_on_the_usage_record(tmp_path, monkeypatch):
    """The factory-built preparer, driven through orchestrator.run over the
    fake transport: the request's language hint sends the query to
    translation, whose dispatch claims one AUXILIARY model call — the run's
    usage record counts it (alongside the judge's), and the status lands."""
    import agent.orchestrator as orchestrator_module

    transport = PreparationFakeTransport(
        responses={
            f"{ENDPOINT}/v1/chat/completions": (
                200,
                {"choices": [{"finish_reason": "stop", "message": {"content": "the english query"}}]},
            )
        }
    )
    monkeypatch.setattr(orchestrator_module, "HttpxTransport", lambda tls_verify: transport)
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    )

    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((*multihop_turns(answer="the answer"), _judge_turn())),
        port,
        tmp_path,
        preparer_factory=factory,
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(language="fr"), sink=events.append))

    assert record.outcome == "answered"
    assert record.preparation_status == "translated"  # the translation succeeded
    # The usage record counts the preparation translation: ONE preparation
    # aux claim + the grounding judge's — the fleet budget's aux tally.
    assert record.aux_model_calls == 2
    # The translated text is what reached the port.
    assert port.search_calls[0]["request"].query.text == "the english query"
    assert any(call["url"].endswith("/v1/chat/completions") for call in transport.calls)
