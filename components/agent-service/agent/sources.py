# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The tool-source port — where a run's tools come from.

A source is a set of tools the deployment DECLARES. The core does not
compose them: the host names the sources a deployment runs and how they
are configured, and the core asks each of them for the tools it may
offer to ONE request.

The port's shape is the design's (§4.3), verbatim — the core's contract
with a source is ONE method:

    class ToolSource(Protocol):
        def tools(self, context, bearer) -> Sequence[tuple[ToolDefinition, ToolExecutor]]: ...

The deployment's facts about a source are DECLARED ON THE CORE'S CLASS
(``source_id``, ``served_tool_names`` — below), because this source is
the core's own product and its identity is stable; the PORT (the
protocol below) carries neither — a second source (``web_search``,
S3-plan-2) declares its own facts on its own class, and the port stays
source-agnostic. The HOST reads them off the concrete class when it
fills ``tool_catalog.DeclaredSource`` (§4.4): one WRITER of the facts
(the class that owns them), one READER (the host's record) — not two
homes that can disagree.

The identity travels with the CALL, never with the construction: the
source is built per request (the budget, the preparation leg and the
insufficiency recorder are the run's), and the caller's context and
bearer arrive with ``tools()``. The executor captures them there — the
narrowing travels in the context, never in the arguments, so nothing the
model contributes can widen the scope.
"""

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Annotated, Protocol

from pydantic import StringConstraints, TypeAdapter

from capabilities.contract import (
    WEB_SEARCH_SOURCE,
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
    WebSearchPort,
)
from preparation.detection import detect_language
from preparation.prepare import QueryPreparer
from preparation.translation import TranslationInputTooLongError

from .registry import ToolDefinition, ToolExecutor

# The search query argument, validated on BOTH executor paths (probe and
# prepared): a missing, non-string or blank query is an argument the
# contract refuses — the SAME structured ``ValidationError`` the read
# executor's target validation raises, which the loop feeds back as the
# structured tool result instead of killing the run.
_QUERY_TEXT = TypeAdapter(Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)])

SEARCH_KNOWLEDGE_DEFINITION = ToolDefinition(
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
)

READ_SOURCE_DEFINITION = ToolDefinition(
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
)

# The read target, validated the same way on every request: the adapter is
# stateless, so it is built ONCE beside the definitions — a per-request
# construction buys nothing.
_SOURCE_REF = TypeAdapter(SourceRef)

WEB_SEARCH_DEFINITION = ToolDefinition(
    name="web_search",
    description=(
        "Search the public web through the deployment's meta-search service. Returns ranked "
        "web results (title, URL, snippet) as reference material."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
        },
        "required": ["query"],
    },
)


@dataclass(frozen=True)
class ToolSourceContext:
    """What one request hands the sources it builds.

    The core owns the bundle: the caller's identity, the operation
    budget, the run's preparation entry and the run's two sinks (the
    preparation status and the insufficiency reason) are all the core's.
    The host builds the sources FROM the bundle — the host declares
    WHICH sources and HOW, the core owns WHAT one request carries.
    """

    context: CallerContext
    bearer: str | None
    operation_budget: OperationBudget
    preparer: QueryPreparer | None = None
    on_preparation_status: Callable[[str], None] | None = None
    abstention_sink: list[str] | None = None


class ToolSource(Protocol):
    """One declared source of tools.

    The design's §4.3 protocol, verbatim: ONE method, and the core reads
    only that method. The deployment's facts about a source — the id the
    catalog names it by, the tools it serves — are the HOST's (the host
    holds the catalog, and the host discovers a source's tools at
    startup), so the port does not declare them.
    """

    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]: ...


class DocumentToolSource:
    """The document source: the two document tools, unchanged.

    The two document tools, unchanged — the same definitions, the same
    executors, the same preparation leg and the same insufficiency
    recorder. What changes is WHERE the caller's
    identity enters: it arrives with ``tools()``, so the executor
    captures the context and the bearer of the CALL rather than the ones
    the source happened to be built with.

    ``budgets`` carries per-tool BOUND OVERRIDES — keyed by tool name,
    each one TIGHTENS the ceiling the source was built with (an
    override may never widen a bound); a tool without an override runs
    under ``operation_budget``. The core does not know where the map
    comes from — the host derives it (``tool_catalog``'s
    ``budget_overrides``) and hands it in.
    """

    source_id = "document"
    served_tool_names = frozenset({"search_knowledge", "read_source"})

    def __init__(
        self,
        port_factory: Callable[[CallerContext, str | None], DocumentCapabilityPort],
        operation_budget: OperationBudget,
        *,
        budgets: dict[str, OperationBudget] | None = None,
        preparer: QueryPreparer | None = None,
        on_preparation_status: Callable[[str], None] | None = None,
        abstention_sink: list[str] | None = None,
    ) -> None:
        self._port_factory = port_factory
        self._operation_budget = operation_budget
        self._budgets = budgets or {}
        self._preparer = preparer
        self._on_preparation_status = on_preparation_status
        self._abstention_sink = abstention_sink

    def _budget_for(self, name: str) -> OperationBudget:
        """One tool's bound: the catalog's override when it declares one,
        the deployment's ceiling otherwise."""
        return self._budgets.get(name, self._operation_budget)

    @classmethod
    def from_bundle(
        cls,
        port_factory: Callable[[CallerContext, str | None], DocumentCapabilityPort],
        bundle: ToolSourceContext,
        *,
        budgets: dict[str, OperationBudget] | None = None,
    ) -> "DocumentToolSource":
        """One construction home for a per-request build: the bundle's run
        wiring forwarded (the preparation leg, the two sinks), the catalog's
        budget map handed through. The host's ``DeclaredSource.build`` and
        the suites' factories all land HERE, so a new bundle field is a
        one-site edit, not a sweep over forwarding lambdas."""
        return cls(
            port_factory,
            bundle.operation_budget,
            budgets=budgets,
            preparer=bundle.preparer,
            on_preparation_status=bundle.on_preparation_status,
            abstention_sink=bundle.abstention_sink,
        )

    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]:
        """The two document tools, bound to THIS request's identity."""
        port = self._port_factory(context, bearer)
        return (
            (
                SEARCH_KNOWLEDGE_DEFINITION,
                _make_search_executor(
                    port,
                    context,
                    self._budget_for("search_knowledge"),
                    self._preparer,
                    self._on_preparation_status,
                    self._abstention_sink,
                ),
            ),
            (
                READ_SOURCE_DEFINITION,
                _make_read_executor(port, context, self._budget_for("read_source")),
            ),
        )


class WebSearchToolSource:
    """The web-search source: the query redacted before anything leaves.

    The ``DocumentToolSource`` shape: the deployment's facts ON THE CLASS
    (the id the catalog names it by, the one tool it serves), the port
    built per request by the injected factory, the per-tool budget
    override map. What differs is what the port does — the LEAF adapter
    (``capabilities/adapters/web_search.py``) runs the outbound pass and
    the search, and this source does no I/O of its own (R1: the core
    names the port, the adapter reaches). There is no preparation leg
    here: the schema asks the model for an English query, and the text
    that leaves is the outbound pass's redacted one — never the model's
    raw query.
    """

    source_id = WEB_SEARCH_SOURCE
    served_tool_names = frozenset({"web_search"})
    # The source DECLARES the PII egress path it implements: the query
    # passes the pii-service, or the call fails closed. The catalog
    # carries an open-web entry only for a source that declares it.
    honours_open_web_egress = True

    def __init__(
        self,
        port_factory: Callable[[CallerContext, str | None], WebSearchPort],
        operation_budget: OperationBudget,
        *,
        budgets: dict[str, OperationBudget] | None = None,
    ) -> None:
        self._port_factory = port_factory
        self._operation_budget = operation_budget
        self._budgets = budgets or {}

    def _budget_for(self, name: str) -> OperationBudget:
        """One tool's bound: the catalog's override when it declares one,
        the deployment's ceiling otherwise (the document source's rule)."""
        return self._budgets.get(name, self._operation_budget)

    @classmethod
    def from_bundle(
        cls,
        port_factory: Callable[[CallerContext, str | None], WebSearchPort],
        bundle: ToolSourceContext,
        *,
        budgets: dict[str, OperationBudget] | None = None,
    ) -> "WebSearchToolSource":
        """The same one construction home, for this source's wiring: the
        bundle carries no preparation leg here — the web query is searched
        as the model wrote it, redacted."""
        return cls(port_factory, bundle.operation_budget, budgets=budgets)

    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]:
        """The one web tool, bound to THIS request's identity."""
        port = self._port_factory(context, bearer)
        return (
            (
                WEB_SEARCH_DEFINITION,
                _make_web_search_executor(port, context, self._budget_for("web_search")),
            ),
        )


def _make_web_search_executor(port: WebSearchPort, context: CallerContext, budget: OperationBudget):

    async def execute(arguments: dict) -> dict:
        # The SAME argument validation the document search runs (the
        # structured ``ValidationError`` the loop feeds back as tool data —
        # never a TypeError that would kill the run, never a port call).
        query_text = _QUERY_TEXT.validate_python(arguments.get("query"))
        return await port.search(query_text, budget)

    return execute


def _make_search_executor(
    port: DocumentCapabilityPort,
    context: CallerContext,
    budget: OperationBudget,
    preparer=None,
    on_preparation_status=None,
    abstention_sink=None,
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
        # The dispatch records into a FRESH per-call list (the noagent
        # pipeline's exact shape); afterwards the run's list is kept at
        # THIS dispatch's reasons — cleared when the search recorded
        # nothing, so a later successful search after an insufficient hop
        # records no reason and the record never misattributes an earlier
        # hop's insufficiency onto a run that answered from later
        # evidence. The capability fires at most one reason per call.
        sink_reasons: list[str] = []
        result = await port.search_knowledge(
            context,
            SearchKnowledgeInput(query=prepared),
            budget,
            abstention_sink=sink_reasons.append if abstention_sink is not None else None,
        )
        if abstention_sink is not None:
            abstention_sink.clear()
            abstention_sink.extend(sink_reasons)
        return result.model_dump(mode="json")

    return execute


def _make_read_executor(port: DocumentCapabilityPort, context: CallerContext, budget: OperationBudget):

    async def execute(arguments: dict) -> dict:
        target = _SOURCE_REF.validate_python(arguments.get("target"))
        result = await port.read_source(context, ReadSourceInput(target=target), budget)
        return result.model_dump(mode="json")

    return execute
