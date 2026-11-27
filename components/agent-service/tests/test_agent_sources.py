# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production document source and the preparation leg in the governed run.

Mutation-sensitive pins: the registered toolset is built over
``agent.sources``' source and the suites reach the shared helper in
``conftest`` (the probe does NOT re-export a builder); the probe path
(``preparer=None``) keeps the pre-move builder's
behavior except a missing or blank query, now refused before the port (a
valid query rides ``passthrough_english``); a wired preparer
feeds the PREPARED query to the port (never the raw text) and reports its
status; an unprepared preparation answers the contract's insufficiency
shape with the port UNTOUCHED; a preparation bound that outlives the
dispatch's operation budget answers the same fallback_timeout shape; a
translation overflow is the contract's TransientError — structured tool
feedback the run survives (never an untranslated fallback, never a killed
run); the budgeted translator claims one AUXILIARY model call per
translation dispatch BEFORE the request leaves, and a spent fleet budget
refuses it before any call.
"""

import asyncio
import json

import pytest
from conftest import (
    ENDPOINT,
    AgentFakePort,
    FakeConceptSource,
    FakeMetadataSource,
    PreparationFakeTransport,
    ScriptedLoopModel,
    canned_read_result,
    canned_search_result,
    document_registry,
    multihop_turns,
    orchestrator_config,
    run_budget,
)

import agent.sources
import measurement.probe
from agent.budget import RunBudgetMonitor
from agent.events import AgentEvent
from agent.orchestrator import (
    AgentRunRequest,
    BudgetedTranslationClient,
    RequestOrchestrator,
    build_preparer_factory,
)
from agent.prompt import PRODUCTION_SYSTEM_PROMPT
from agent.registry import build_registry
from agent.sources import READ_SOURCE_DEFINITION, SEARCH_KNOWLEDGE_DEFINITION, DocumentToolSource
from agent.verification import INSUFFICIENCY_RESPONSE
from capabilities.contract import (
    CallerContext,
    OperationBudget,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
)
from capabilities.model import ModelTurn, ToolCallRequest
from lane import AdmissionLane
from measurement.probe import PROBE_SYSTEM_PROMPT
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
# The document source: the registered toolset left the probe module
# ---------------------------------------------------------------------


def test_the_probe_reimports_the_moved_source():
    assert measurement.probe.DocumentToolSource is agent.sources.DocumentToolSource
    # The probe module keeps its own prompt; the governed default is the
    # production one (the orchestrator's default, not the harness's).
    assert PROBE_SYSTEM_PROMPT != PRODUCTION_SYSTEM_PROMPT


def test_the_probe_path_is_unchanged_passthrough():
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_registry(port, CONTEXT, orchestrator_config().operation_budget)
    assert registry.names() == ("search_knowledge", "read_source")

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))

    assert result["outcome"] == "success"
    # The model's valid query rides the passthrough status — no
    # preparation call, the pre-move probe builder's behavior.
    [call] = port.search_calls
    assert call["request"].query.text == "the model query"
    assert call["request"].query.preparation_status == QueryPreparationStatus.PASSTHROUGH_ENGLISH


def test_the_executor_carries_the_identity_of_the_call_not_of_the_construction():
    """The narrowing travels in the context, never in the arguments.

    The source is built ONCE; the caller's identity arrives with the
    CALL. Two calls on one source must reach two different ports — the
    one each call's identity bound — and the executor must keep that
    binding for the whole life of the pair it returned.
    """
    served: list[tuple[CallerContext, str | None]] = []
    ports: dict[str, AgentFakePort] = {}

    def port_factory(context, bearer):
        served.append((context, bearer))
        port = AgentFakePort(search_result=canned_search_result())
        ports[bearer] = port
        return port

    source = DocumentToolSource(port_factory, orchestrator_config().operation_budget)
    first = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
    second = CallerContext(user_id="u-2", authorized_graph_names=("GRAPH",))

    build_registry(source.tools(first, "bearer-1"))
    second_registry = build_registry(source.tools(second, "bearer-2"))

    # The identity travelled with the CALL, not with the construction.
    assert served == [(first, "bearer-1"), (second, "bearer-2")]

    # The SECOND registry's executor answers through the SECOND call's
    # port, with the SECOND call's context — the narrowing is the
    # context's, and it never reaches the arguments.
    asyncio.run(second_registry.dispatch("search_knowledge", {"query": "the model query"}))
    assert len(served) == 2, "the executor re-bound the port at dispatch time"
    [call] = ports["bearer-2"].search_calls
    assert call["context"] is second


def test_a_tighter_per_tool_budget_reaches_the_executor():
    """The ``budgets=`` override is a real wiring, not decoration: the
    budget the source hands the executor for a NAMED tool is the
    OVERRIDE — the ceiling stays for every tool the map does not name."""
    override = OperationBudget(timeout_ms=1000, max_results=1, max_result_bytes=1024)
    port = AgentFakePort(search_result=canned_search_result())
    source = DocumentToolSource(
        lambda context, bearer: port,
        orchestrator_config().operation_budget,
        budgets={"search_knowledge": override},
    )
    registry = build_registry(source.tools(CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",)), None))
    asyncio.run(registry.dispatch("search_knowledge", {"query": "q"}))
    # The fake records the budget every call carries: the override rode.
    assert port.search_calls[0]["budget"] is override


def test_the_request_bundle_carries_the_call_s_full_identity():
    """``ToolSourceContext`` is the per-request bundle: the context, the
    bearer and the operation budget travel together to the port."""
    context = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
    budget = orchestrator_config().operation_budget  # ONE call: the config is a factory
    bundle = agent.sources.ToolSourceContext(context=context, bearer="tok-1", operation_budget=budget)
    assert bundle.context is context
    assert bundle.bearer == "tok-1"
    assert bundle.operation_budget is budget


def test_the_tool_definitions_move_verbatim():
    """The model-facing contract moves byte for byte.

    The definitions are what the model is told: the name, the
    description and the parameter schema. Nothing else in the tree pins
    them (the recorded event stream carries the CALLS, not the
    definitions), so a drifted description or a dropped ``required`` key
    would pass every other gate of this plan. This pin is the witness.
    The names ride the suite's import row (Step 7's table) — no local
    import: a second one reds F811 against it.
    """

    assert SEARCH_KNOWLEDGE_DEFINITION.name == "search_knowledge"
    assert SEARCH_KNOWLEDGE_DEFINITION.description == (
        "Search the authorized knowledge corpus. Returns ranked passages with their provenance, "
        "or an explicit insufficient-evidence outcome."
    )
    assert SEARCH_KNOWLEDGE_DEFINITION.parameters == {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
        },
        "required": ["query"],
    }
    assert READ_SOURCE_DEFINITION.name == "read_source"
    assert READ_SOURCE_DEFINITION.description == (
        "Read one source the search results pointed at. A legacy document is addressed by its "
        'file_id ("target": {"file_id": ...}); an OKF concept by repo_id and concept_id '
        '("target": {"repo_id": ..., "concept_id": ...}).'
    )
    assert READ_SOURCE_DEFINITION.parameters == {
        "type": "object",
        "properties": {
            "target": {
                "type": "object",
                "description": 'Either {"file_id": ...} or {"repo_id": ..., "concept_id": ...}.',
            },
        },
        "required": ["target"],
    }


def test_the_declared_definitions_stay_within_their_prompt_allowance():
    """The two definitions ride EVERY model call's prompt: their size is
    a budget fact, pinned where the definitions live. When the budget
    slice (S4) wires the prompt accounting it reads THIS number — a
    definition that grows silently moves it."""
    import dataclasses

    payload = json.dumps([dataclasses.asdict(d) for d in (SEARCH_KNOWLEDGE_DEFINITION, READ_SOURCE_DEFINITION)])
    assert len(payload) <= 4096


# ---------------------------------------------------------------------
# The preparation leg: the prepared query feeds the search
# ---------------------------------------------------------------------


def test_a_wired_preparer_feeds_the_prepared_query_to_the_port():
    preparer = FakePreparer(_preparation_result(QueryPreparationStatus.TRANSLATED, "the english query"))
    statuses: list[str] = []
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_registry(
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
    registry = document_registry(
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


def test_an_unclassifiable_query_rides_the_locale_and_never_claims_english():
    """A query the REAL detector cannot classify ("???" carries no
    linguistic features) rides the request's locale — the preparer's own
    default — and the search the caller can still have runs. With no
    locale anywhere, the module's own unknown-language status refuses the
    query: never passthrough_english, whose raw text would be embedded
    into the English-only space with a prepared label."""
    from preparation import PreparationConfig, QueryPreparer
    from preparation.registry import LanguageRegistry

    env = {"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    config = PreparationConfig.load(env=env)
    registry = LanguageRegistry(config.registry_path)

    # No locale anywhere: the refusal, on the module's own status.
    translator = RecordingTranslator(config, registry)
    preparer = QueryPreparer(config, registry, translator, default_source_language=None)
    statuses: list[str] = []
    port = AgentFakePort(search_result=canned_search_result())
    registry_tools = document_registry(
        port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer, on_preparation_status=statuses.append
    )
    result = asyncio.run(registry_tools.dispatch("search_knowledge", {"query": "???"}))
    assert result == {
        "outcome": "insufficient_evidence",
        "hits": [],
        "truncated": False,
        "query_preparation_status": "passthrough_unknown_language",
    }
    assert port.search_calls == []
    assert statuses == ["passthrough_unknown_language"]
    assert translator.prompts == []  # nothing was translated from nothing

    # A named locale speaks for the query: the search runs, prepared.
    translator = RecordingTranslator(config, registry)
    preparer = QueryPreparer(config, registry, translator, default_source_language="fr")
    port = AgentFakePort(search_result=canned_search_result())
    registry_tools = document_registry(port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer)
    result = asyncio.run(registry_tools.dispatch("search_knowledge", {"query": "???"}))
    assert result["outcome"] == "success"
    assert port.search_calls[0]["request"].query.preparation_status == QueryPreparationStatus.TRANSLATED
    assert len(translator.prompts) == 1


def test_an_over_budget_query_is_the_contract_transient_carrier():
    """The over-budget input is structured tool feedback, not a run error:
    the executor raises the contract's TransientError (the same carrier the
    port's operation-budget refusals use — retryable with a shorter
    query), which the loop maps to the error envelope."""
    from capabilities.contract import TransientError

    preparer = FakePreparer(TranslationInputTooLongError("the query exceeds the translation budget"))
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_registry(port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer)

    with pytest.raises(TransientError, match="translation budget"):
        asyncio.run(registry.dispatch("search_knowledge", {"query": "trop long"}))
    assert port.search_calls == []


def test_a_hanging_preparation_is_bounded_at_the_operation_budget():
    """The preparation call is bounded at the dispatch's own operation
    budget (its internals only know the translation service's generous
    timeout, and the wall clock is checked only between dispatches): a
    slow-but-alive endpoint answers the structured fallback_timeout
    envelope — the port untouched, the status recorded, the run honest."""
    import asyncio as aio

    class HangingPreparer:
        async def prepare(self, text, source_language=None):
            await aio.Event().wait()  # forever — the wait_for must cut it

    statuses: list[str] = []
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_registry(
        port,
        CONTEXT,
        OperationBudget(timeout_ms=50, max_results=8, max_result_bytes=65536),
        preparer=HangingPreparer(),
        on_preparation_status=statuses.append,
    )

    result = aio.run(aio.wait_for(registry.dispatch("search_knowledge", {"query": "any query"}), timeout=5))

    assert result == {
        "outcome": "insufficient_evidence",
        "hits": [],
        "truncated": False,
        "query_preparation_status": "fallback_timeout",
    }
    assert statuses == ["fallback_timeout"]
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
    registry = document_registry(port, CONTEXT, orchestrator_config().operation_budget, preparer=preparer)

    for bad_arguments in ({}, {"query": None}, {"query": "   "}):
        with pytest.raises(ValidationError):
            asyncio.run(registry.dispatch("search_knowledge", bad_arguments))

    assert port.search_calls == []
    if preparer is not None:
        assert preparer.calls == []  # the refusal precedes preparation too


# ---------------------------------------------------------------------
# The abstention sink: the run's per-call hook rides the toolset call
# ---------------------------------------------------------------------


def test_the_run_abstention_sink_rides_the_toolset_call_to_the_port():
    """The recording list the caller supplies (the run's) is kept at the
    search dispatch's recorded reason, and the port receives the per-call
    hook — the agent-path counterpart of the noagent pipeline's
    direct-call recording."""
    reasons: list[str] = []
    port = AgentFakePort(
        search_result=canned_search_result(hits=(), outcome=OutcomeCode.INSUFFICIENT_EVIDENCE),
        sink_reason="no_documents_retrieved",
    )
    registry = document_registry(port, CONTEXT, orchestrator_config().operation_budget, abstention_sink=reasons)

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))

    assert result["outcome"] == "insufficient_evidence"
    assert reasons == ["no_documents_retrieved"]
    assert port.search_calls[0]["abstention_sink"] is not None


def test_an_absent_abstention_sink_passes_none_to_the_port():
    """No sink supplied (the probe path, any caller that does not want the
    reason): the port call carries ``abstention_sink=None`` — the contract's
    optional hook stays optional, no behavior change."""
    port = AgentFakePort(search_result=canned_search_result())
    registry = document_registry(port, CONTEXT, orchestrator_config().operation_budget)

    result = asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))

    assert result["outcome"] == "success"
    assert port.search_calls[0]["abstention_sink"] is None


# ---------------------------------------------------------------------
# In the governed run: preparation status, usage record, honest overflow
# ---------------------------------------------------------------------


def _orchestrator(model, port, tmp_path, *, preparer_factory=None, config=None):
    return RequestOrchestrator(
        config=config if config is not None else orchestrator_config(),
        lane=AdmissionLane(1, str(tmp_path / "lane.lock")),
        model_client=model,
        port_factory=lambda context, bearer: port,
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
        preparer_factory=preparer_factory,
    )


def _request(**overrides):
    values = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT, "language": "fr"}
    return AgentRunRequest(**{**values, **overrides})


class RecordingTranslator(TranslationClient):
    """A real TranslationClient whose dispatch is canned and recorded: the
    observable of the bound default hint — a query the hint routes to
    translation REACHES translate_prompt (with no hint, detection would
    pass the English-looking query straight through). The discovery reads
    are answered in-place (no endpoint probe): the executor now bounds
    prepare() at the operation budget, and a DNS-hung probe would race it."""

    def __init__(self, config, registry):
        super().__init__(config, registry, transport=PreparationFakeTransport())
        self.prompts: list[str] = []

    async def translation_window(self):
        return None

    async def translation_model_id(self):
        return self._config.model_id or "test-model"

    async def translate_prompt(self, prompt: str, translategemma: bool, model_id: str | None) -> str:
        self.prompts.append(prompt)
        return "the english query"


def test_the_run_record_carries_language_and_the_first_preparation_status(tmp_path):
    """The request's locale rides the run record, and the first search
    query's preparation status rides with it. The QUERY's own language
    decides the preparation: the model writes English queries (the tool
    schema asks for them), so a French UI locale never forces an English
    query through a translation pass that could reword it."""
    env = {"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    config = PreparationConfig.load(env=env)
    registry = LanguageRegistry(config.registry_path)

    # The REAL factory shape: the shipped QueryPreparer carries the
    # request's locale as its default source language.
    translator = RecordingTranslator(config, registry)
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    english_search = multihop_turns(answer="the answer")

    turns = (
        ModelTurn(
            tool_calls=(
                ToolCallRequest(call_id="call-1", name="search_knowledge", arguments={"query": "grid outage report"}),
            )
        ),
    ) + english_search[1:]
    orchestrator = _orchestrator(
        ScriptedLoopModel((*turns, _judge_turn())),
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
    assert record.preparation_status == "passthrough_english"  # the FIRST query's status
    # The English model query passed through untouched: no translation
    # dispatch under a foreign UI locale, and the raw text is what the
    # port received.
    assert translator.prompts == []
    assert port.search_calls[0]["request"].query.text == "grid outage report"
    assert port.search_calls[0]["request"].query.preparation_status == QueryPreparationStatus.PASSTHROUGH_ENGLISH


def test_a_model_query_in_the_users_language_is_still_translated(tmp_path):
    """The model echoing the user's language is the case the preparation
    leg exists for: the query's own language decides, so a French query is
    translated to English for the English-only embedding space — with or
    without a locale hint."""
    env = {"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    config = PreparationConfig.load(env=env)
    registry = LanguageRegistry(config.registry_path)
    translator = RecordingTranslator(config, registry)
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())

    first_search = multihop_turns(answer="the answer")
    turns = (
        ModelTurn(
            tool_calls=(
                ToolCallRequest(
                    call_id="call-1",
                    name="search_knowledge",
                    arguments={"query": "signalement d'une panne du réseau électrique"},
                ),
            )
        ),
    ) + first_search[1:]
    orchestrator = _orchestrator(
        ScriptedLoopModel((*turns, _judge_turn())),
        port,
        tmp_path,
        preparer_factory=lambda monitor, language=None: QueryPreparer(
            config, registry, translator, default_source_language=language
        ),
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(language=None), sink=events.append))

    assert record.outcome == "answered"
    assert record.preparation_status == "translated"
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


def test_an_overflow_query_is_structured_feedback_the_run_survives(tmp_path):
    """The over-budget query is the SAME mistake surface as any refused
    argument: the executor raises the contract's TransientError, the loop
    feeds it back as the structured tool envelope, the model can retry with
    a shorter query — the run no longer dies on this input, and the port is
    never reached with unprepared text."""

    def factory(monitor, language=None):
        return FakePreparer(TranslationInputTooLongError("the query exceeds the translation budget"))

    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    model = ScriptedLoopModel((*multihop_turns(answer="answering from what was served."), _judge_turn()))
    orchestrator = _orchestrator(
        model,
        port,
        tmp_path,
        preparer_factory=factory,
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.outcome == "answered"  # the run survived the refused argument
    finished = next(event for event in events if event.kind.value == "tool_call_finished")
    assert finished.payload["error"]["code"] == "transient_failure"
    assert finished.payload["error"]["operation"] == "search_knowledge"
    assert "translation budget" in finished.payload["error"]["message"]
    assert port.search_calls == []  # never reached with unprepared text
    # The envelope rode to the model as tool data.
    served = [m for request in model.requests for m in request["messages"]]
    assert any(m.get("role") == "tool" and "transient_failure" in m.get("content", "") for m in served)


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


def test_a_hanging_preparation_run_delivers_the_standard_insufficiency(tmp_path):
    """Run-level: the bounded preparation's fallback envelope cites nothing,
    so the mechanical decision fires — the drafted confident text is
    discarded and the standard insufficiency response is the delivered
    answer (the port never reached, the judge skipped)."""
    import asyncio as aio

    class HangingPreparer:
        async def prepare(self, text, source_language=None):
            await aio.Event().wait()  # forever — the operation bound cuts it

    search_turn = ModelTurn(
        tool_calls=(ToolCallRequest(call_id="call-1", name="search_knowledge", arguments={"query": "q"}),)
    )
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    orchestrator = _orchestrator(
        ScriptedLoopModel((search_turn, ModelTurn(content="a confidently fabricated answer"), _judge_turn())),
        port,
        tmp_path,
        preparer_factory=lambda monitor, language=None: HangingPreparer(),
        config=orchestrator_config(
            operation_budget=OperationBudget(timeout_ms=50, max_results=8, max_result_bytes=65536)
        ),
    )
    events: list[AgentEvent] = []

    record = aio.run(aio.wait_for(orchestrator.run(_request(), sink=events.append), timeout=10))

    assert record.outcome == "answered"
    assert record.preparation_status == "fallback_timeout"
    assert record.injection_findings == 0
    assert port.search_calls == []
    content = [event.payload["text"] for event in events if event.kind.value == "text_message_content"]
    assert content == [INSUFFICIENCY_RESPONSE]
    verdict = next(event.payload for event in events if event.kind.value == "verdict")
    assert verdict["insufficient_evidence"] == {"required": True, "reasons": ["no_successful_retrieval"]}
    assert "a confidently fabricated answer" not in [event.payload.get("text", "") for event in events]


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
        PreparationFakeTransport(),
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"},
    )
    first = factory(RunBudgetMonitor(run_budget()))
    second = factory(RunBudgetMonitor(run_budget()))

    assert isinstance(first, QueryPreparer)
    assert isinstance(second, QueryPreparer)
    assert first is not second  # one preparer PER RUN, over the shared wiring


def test_the_real_factory_counts_the_preparation_translation_on_the_usage_record(tmp_path):
    """The factory-built preparer, driven through orchestrator.run over the
    fake transport: the request's language hint sends the query to
    translation, whose dispatch claims one AUXILIARY model call — the run's
    usage record counts it (alongside the judge's), and the status lands."""
    transport = PreparationFakeTransport(
        responses={
            f"{ENDPOINT}/v1/chat/completions": (
                200,
                {"choices": [{"finish_reason": "stop", "message": {"content": "the english query"}}]},
            )
        }
    )
    factory = build_preparer_factory(
        transport,
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"},
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
