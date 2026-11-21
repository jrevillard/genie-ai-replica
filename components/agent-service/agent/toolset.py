# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The production toolset builder — the registered tools a governed run serves.

MOVED here from the probe module (story 2.5): the registered toolset is a
production surface, not a probe artifact. The probe harness re-imports this
builder and its own flow is untouched; the probe path (``preparer=None``)
behaves byte-identically to the pre-move builder.

The registry is the authorization surface (nothing unregistered is
callable); the executors adapt the model-generated JSON arguments into the
contract's input types and carry the fixed ``CallerContext`` — the narrowing
travels in the context, never in the arguments, so nothing the model
contributes can widen the scope; the port stays the only corpus access.

The one production addition over the probe builder is the PREPARATION leg
(story 1.8 consumed per query): when the caller wires a ``QueryPreparer``,
every ``search_knowledge`` query the model writes goes through preparation
before the port — detection decides the query's language, a non-English
query is translated to English through the budgeted aux call (the claim
fires inside the budgeted translator wrapper the orchestrator wires), and
the PREPARED query — never the raw text — reaches the port, which refuses
everything unprepared. An unprepared preparation (a fallback status) is
reported to the model as the contract's own insufficiency answer shape:
never a source-language query dressed as prepared. An input that does not
fit the translation budget raises the typed
:class:`preparation.translation.TranslationInputTooLongError`, which
propagates into the loop's honest run-error contract.
"""

from typing import Annotated

from pydantic import StringConstraints, TypeAdapter

from capabilities.contract import (
    CallerContext,
    DocumentCapabilityPort,
    OperationBudget,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchKnowledgeInput,
    SourceRef,
)

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
            # single-message shape — the refined mid-loop query is prepared
            # identically to the initial one).
            preparation = await preparer.prepare(query_text)
            if on_preparation_status is not None:
                on_preparation_status(preparation.status.value)
            if not preparation.prepared:
                # An unprepared preparation is a degradation, never dressed
                # as a prepared query: report it in the contract's own
                # insufficiency answer shape (the same three fields the port
                # reports). The ledger classifies it as citing nothing, and
                # the model sees an insufficiency it can react to.
                return {
                    "outcome": "insufficient_evidence",
                    "hits": [],
                    "truncated": False,
                    "query_preparation_status": preparation.status.value,
                }
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
