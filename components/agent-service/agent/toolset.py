# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production toolset builder — the registered tools a governed run serves.

MOVED here from the probe module: the registered toolset is a production
surface, not a probe artifact. The probe harness re-imports this builder and
its own flow is untouched; the probe path (``preparer=None``) keeps the
pre-move builder's behavior EXCEPT that a missing or blank query is now
refused before the port (the shared validation both paths run).

The registry is the authorization surface (nothing unregistered is
callable); the executors adapt the model-generated JSON arguments into the
contract's input types and carry the fixed ``CallerContext`` — the narrowing
travels in the context, never in the arguments, so nothing the model
contributes can widen the scope; the port stays the only corpus access.

The one production addition over the probe builder is the PREPARATION leg
(the preparation module, consumed per query): when the caller wires a
``QueryPreparer``, every ``search_knowledge`` query the model writes
through preparation before the port — detection decides the query's
language, a non-English query is translated to English through the
budgeted aux call (the claim
fires inside the budgeted translator wrapper the orchestrator wires), and
the PREPARED query — never the raw text — reaches the port, which refuses
everything unprepared. An unprepared preparation (a fallback status), or a
preparation bound that outlives the dispatch's operation budget, is
reported to the model as the contract's own insufficiency answer shape:
never a source-language query dressed as prepared. An input that does not
fit the translation budget is the SAME structured mistake surface as any
refused argument: a contract ``TransientError`` the loop feeds back as
tool data, retryable with a shorter query — never a run-killing escape.
"""

import asyncio
from typing import Annotated

from pydantic import StringConstraints, TypeAdapter

from capabilities.contract import (
    CallerContext,
    DocumentCapabilityPort,
    OperationBudget,
    OperationName,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    SourceRef,
    TransientError,
)
from preparation.detection import detect_language
from preparation.translation import TranslationInputTooLongError

from .registry import ToolDefinition, ToolRegistry

# The search query argument, validated on BOTH executor paths (probe and
# prepared): a missing, non-string or blank query is an argument the
# contract refuses — the SAME structured ``ValidationError`` the read
# executor's target validation raises, which the loop feeds back as the
# structured tool result instead of killing the run.
_QUERY_TEXT = TypeAdapter(Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)])


def document_toolset(
    port: DocumentCapabilityPort,
    context: CallerContext,
    operation_budget: OperationBudget,
    preparer=None,
    on_preparation_status=None,
) -> ToolRegistry:
    """The document toolset: search + read, executors bound to the port.

    ``preparer`` (optional — the probe passes none) is the preparation
    module's entry; ``on_preparation_status`` (optional) receives each
    query's :class:`~capabilities.contract.QueryPreparationStatus` value, so
    the caller records what preparation actually did. The executors adapt
    the model-generated JSON arguments into the contract's input types — a
    ``PreparedQuery`` and a ``SourceRef`` — and carry the fixed
    ``CallerContext``. An argument the contract refuses (a missing query, a
    malformed target) raises ``ValidationError``, which the loop feeds back
    as the structured tool result.
    """
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="search_knowledge",
            description=(
                "Search the authorized knowledge corpus. Returns ranked passages with their provenance, "
                "or an explicit insufficient-evidence outcome."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The English search query."},
                },
                "required": ["query"],
            },
        ),
        _make_search_executor(port, context, operation_budget, preparer, on_preparation_status),
    )
    registry.register(
        ToolDefinition(
            name="read_source",
            description=(
                "Read one source the search results pointed at. A legacy document is addressed by its "
                'file_id ("target": {"file_id": ...}); an OKF concept by repo_id and concept_id '
                '("target": {"repo_id": ..., "concept_id": ...}).'
            ),
            parameters={
                "type": "object",
                "properties": {
                    "target": {
                        "type": "object",
                        "description": 'Either {"file_id": ...} or {"repo_id": ..., "concept_id": ...}.',
                    },
                },
                "required": ["target"],
            },
        ),
        _make_read_executor(port, context, operation_budget),
    )
    return registry


def _make_search_executor(
    port: DocumentCapabilityPort,
    context: CallerContext,
    budget: OperationBudget,
    preparer=None,
    on_preparation_status=None,
):
    def _unprepared_envelope(status: QueryPreparationStatus) -> dict:
        """The contract's insufficiency answer for a query that could not be
        prepared (a fallback status, or the preparation bound timing out) —
        built through SearchKnowledgeResult, whose fields this mirrors field
        for field, so a contract change cannot leave this shape behind.
        model_construct (validation bypassed) is required for one field
        only: the contract narrows ``query_preparation_status`` to the
        PREPARED statuses (a SERVED result always had a prepared query),
        and this result carries the fallback status that says WHY nothing
        was served. The ledger classifies it as citing nothing, and the
        model sees an insufficiency it can react to."""
        if on_preparation_status is not None:
            on_preparation_status(status.value)
        return SearchKnowledgeResult.model_construct(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            hits=(),
            truncated=False,
            query_preparation_status=status,
        ).model_dump(mode="json")

    async def execute(arguments: dict) -> dict:
        # BOTH paths validate the argument the same way, BEFORE anything
        # runs: a missing, non-string or blank query raises the structured
        # ``ValidationError`` the loop feeds back as tool data — never a
        # TypeError that would kill the whole run.
        query_text = _QUERY_TEXT.validate_python(arguments.get("query"))
        if preparer is None:
            # No preparation wired (the probe path): the question is English
            # by construction, so no preparation call is needed.
            prepared = PreparedQuery(text=query_text, preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH)
        else:
            # The string IS the retrieval query (the preparation module's
            # single-message shape — every query the model writes is
            # prepared the same way). The QUERY's own language decides, not
            # the conversation's locale: the schema asks the model for an
            # English query, and a foreign-language hint would send that
            # English query through a translation pass that can reword it.
            # A model that echoes the user's language is translated. When
            # the detector cannot classify the query at all, the request's
            # locale (the preparer's own default) speaks for it — the
            # search the caller can still have (an English locale answers
            # passthrough_english: the locale establishes the English);
            # with no locale anywhere, the module's own unknown-language
            # status refuses it — no English is claimed that nothing
            # established, whose raw text would be embedded into the
            # English-only space with a prepared label.
            query_language = detect_language(query_text)
            # The call is BOUNDED at the dispatch's operation budget — its
            # own pieces only know the translation service's generous
            # timeout, and the run's wall clock is checked only BETWEEN
            # dispatches, so an unbounded preparation would stall this
            # dispatch (and the admission lane with it) for minutes on a
            # slow-but-alive endpoint.
            try:
                preparation = await asyncio.wait_for(
                    preparer.prepare(query_text, query_language), timeout=budget.timeout_ms / 1000
                )
            except TimeoutError:
                # Bounded, not dead: the honest tool answer is the fallback
                # insufficiency — the model can react (retry, reword), and
                # the run stays inside its budget.
                return _unprepared_envelope(QueryPreparationStatus.FALLBACK_TIMEOUT)
            except TranslationInputTooLongError as over_budget:
                # Same mistake surface as any other refused argument: a
                # structured CapabilityError the loop feeds back as tool
                # data (transient — retryable with a shorter query), never
                # a run-killing escape past the executor's catch.
                raise TransientError(
                    f"the query exceeds the translation budget ({over_budget})",
                    operation=OperationName.SEARCH_KNOWLEDGE,
                ) from over_budget
            if not preparation.prepared:
                return _unprepared_envelope(preparation.status)
            if on_preparation_status is not None:
                on_preparation_status(preparation.status.value)
            prepared = preparation.query
        result = await port.search_knowledge(context, SearchKnowledgeInput(query=prepared), budget)
        return result.model_dump(mode="json")

    return execute


def _make_read_executor(port: DocumentCapabilityPort, context: CallerContext, budget: OperationBudget):
    _source_ref = TypeAdapter(SourceRef)

    async def execute(arguments: dict) -> dict:
        target = _source_ref.validate_python(arguments.get("target"))
        result = await port.read_source(context, ReadSourceInput(target=target), budget)
        return result.model_dump(mode="json")

    return execute
