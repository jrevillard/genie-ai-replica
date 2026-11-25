# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The authorization executor — the port's enforcement point.

A contract declares; an executor enforces. Some obligations were declared
but enforced by nobody in the deployed tree; this module is where each of
them becomes enforced:

* **Authorization precedes resolution.** A target outside the request's
  authorized set — or an identifier that fails its charset guard — is
  refused with ``AuthorizationError`` before doc-repo, okf-server or
  ArangoDB is contacted, so the refusal reveals nothing about the target's
  existence (no existence oracle).
* **Every resolved identity is re-validated.** What the adapters resolved
  must be what was authorized: a provenance that drifts from the request,
  or a resolved graph outside the set, fails closed — never a wider corpus.
* **The legacy corpus maps.** A legacy ``file_id`` is in scope iff
  the request's authorized set includes the legacy graph. No per-user ACL
  exists on that corpus, and none is invented here.
* **The negative matrix covers search too.** The executor wraps the inner
  search port and drops every hit whose identity sits outside the set:
  restricted-graph content is not searchable, and an empty authorized set
  never reaches the inner port at all.
* **Per-request identity.** The executor is constructed with one request's
  trusted context; a call that arrives with any other context is refused.
  That is what invalidates retained-evidence reuse across a permission
  change between turns — the next turn's executor carries the next
  turn's set.

Failures keep the contract's carriers: authorization failure and transient
failure are raised, insufficiency and degraded availability are result
outcomes, and a cancellation propagates untouched.
"""

import asyncio
from collections.abc import Awaitable, Callable

from pydantic import ValidationError

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.contract import (
    AuthorizationError,
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OkfConceptRef,
    OperationBudget,
    OperationName,
    OutcomeCode,
    ReadSourceInput,
    ReadSourceResult,
    SearchHit,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    TransientError,
)
from capabilities.identifiers import (
    ensure_graph_name_config,
    validate_concept_id,
    validate_file_id,
    validate_repo_id,
)

_AUTHORIZE = OperationName.READ_SOURCE
_SEARCH = OperationName.SEARCH_KNOWLEDGE


class AuthorizedExecutor:
    """Implements ``DocumentCapabilityPort`` by enforcing the caller context.

    Constructed per request with the context the BFF assembled, the caller's
    bearer (forwarded only to the services that validate their own callers)
    and the read adapters. The inner search port is injected: the
    adapter in production, a fake in tests.
    """

    def __init__(
        self,
        context: CallerContext,
        *,
        bearer: str | None,
        legacy_graph_name: str,
        docrepo: DocRepoAdapter,
        okf: OkfAdapter,
        chunks: LegacyChunkAdapter,
        search_port,
    ) -> None:
        self._context = context
        self._bearer = bearer
        # Deployment configuration, not a caller-supplied identifier: a bad
        # value is the operator's defect and must not surface as a caller
        # authorization failure.
        self._legacy_graph_name = ensure_graph_name_config(legacy_graph_name)
        self._authorized_repos = {repo.repo_id for repo in context.authorized_repos}
        self._authorized_graphs = frozenset(context.authorized_graph_names)
        self._docrepo = docrepo
        self._okf = okf
        self._chunks = chunks
        self._search_port = search_port

    async def search_knowledge(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
        abstention_sink: "Callable[[str], None] | None" = None,
    ) -> SearchKnowledgeResult:
        """Search the authorized corpus; hits outside the set never surface.

        ``abstention_sink`` is the same OPTIONAL per-call hook the inner
        port takes: threading it here means an insufficiency answered
        through the executor records its exact reason the way the direct
        capability path does, instead of losing the reason at the executor
        boundary (the reason survives only in logs there). The executor's
        own authorization refusals (no authorized graphs, no surviving
        authorized hits) record no reason through it — they are
        authorization outcomes, not retrieval insufficiencies.
        """
        self._refuse_a_foreign_context(context, operation=_SEARCH)
        if not context.authorized_graph_names:
            # Fail-closed: nothing is reachable, so nothing is sought. The
            # inner port is not consulted at all.
            return self._insufficient_search(request)
        inner = await self._within_deadline(
            lambda: self._search_port.search_knowledge(context, request, budget, abstention_sink=abstention_sink),
            budget,
            _SEARCH,
        )
        survivors = tuple(candidate for candidate in inner.hits if self._hit_is_authorized(candidate))
        if inner.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE or not survivors:
            return self._insufficient_search(request)
        # The inner capability already caps `hits` at budget.max_results and
        # survivors are a subset — the slice below is the only cut the
        # executor needs; `truncated` reports the inner port's own honesty.
        return SearchKnowledgeResult(
            outcome=inner.outcome,
            hits=survivors[: budget.max_results],
            truncated=inner.truncated,
            query_preparation_status=request.query.preparation_status,
        )

    async def read_source(
        self,
        context: CallerContext,
        request: ReadSourceInput,
        budget: OperationBudget,
    ) -> ReadSourceResult:
        """Read one authorized source; the refusal precedes the resolution."""
        self._refuse_a_foreign_context(context, operation=_AUTHORIZE)
        target = request.target
        if isinstance(target, OkfConceptRef):
            return await self._read_okf_concept(target, budget)
        return await self._read_legacy_file(target.file_id, budget)

    # -- authorization primitives -------------------------------------------

    def _refuse_a_foreign_context(self, context: CallerContext, *, operation: OperationName) -> None:
        if context != self._context:
            raise AuthorizationError(
                "the request's context is not the one this executor was built for", operation=operation
            )

    def _hit_is_authorized(self, candidate: SearchHit) -> bool:
        provenance = candidate.provenance
        if isinstance(provenance, OkfConceptProvenance):
            return provenance.repo_id in self._authorized_repos
        if isinstance(provenance, LegacyFileProvenance):
            return self._legacy_graph_name in self._authorized_graphs
        # Denial by default: a provenance variant the executor does not know
        # is never granted the legacy corpus's rule. The contract's union is
        # closed today, but the filter's default direction stays refusal.
        return False

    # -- the two read paths ---------------------------------------------------

    async def _read_legacy_file(self, file_id: str, budget: OperationBudget) -> ReadSourceResult:
        validate_file_id(file_id, operation=_AUTHORIZE)
        if self._legacy_graph_name not in self._authorized_graphs:
            # The legacy corpus has no per-user ACL — in scope only when
            # the set includes the legacy graph. Refused before doc-repo.
            raise AuthorizationError("the legacy corpus is not in the authorized set", operation=_AUTHORIZE)
        # Resolution (doc-repo metadata) and content (the graph's chunks) share
        # no data dependency — one deadline, both round-trips together, and a
        # TaskGroup so a failing leg cancels its sibling instead of orphaning it.

        async def _both() -> tuple[dict | None, tuple[str, bool]]:
            async with asyncio.TaskGroup() as group:
                metadata_task = group.create_task(self._docrepo.fetch_metadata(file_id, self._bearer))
                chunks_task = group.create_task(
                    self._chunks.read_chunks(self._legacy_graph_name, file_id, budget.max_results)
                )
            return metadata_task.result(), chunks_task.result()

        metadata, (content, chunk_truncated) = await self._within_deadline(_both, budget, _AUTHORIZE)
        if metadata is None:
            return self._insufficient_read()
        return self._finalize_read(
            LegacyFileProvenance(file_id=file_id),
            content,
            chunk_truncated,
            budget,
            empty_is_degradation=True,
        )

    async def _read_okf_concept(self, target: OkfConceptRef, budget: OperationBudget) -> ReadSourceResult:
        validate_repo_id(target.repo_id, operation=_AUTHORIZE)
        validate_concept_id(target.concept_id, operation=_AUTHORIZE)
        if target.repo_id not in self._authorized_repos:
            raise AuthorizationError("the requested repository is not in the authorized set", operation=_AUTHORIZE)
        card = await self._within_deadline(
            lambda: self._okf.fetch_concept(target.repo_id, target.concept_id, self._bearer), budget, _AUTHORIZE
        )
        if card is None:
            return self._insufficient_read()
        # Post-resolution re-validation: what resolved must be what was
        # authorized. A drifting identity, or a resolved graph outside the
        # set, fails closed.
        resolved_graph = card.get("graph_name")
        if (
            card.get("repo_id") != target.repo_id
            or card.get("concept_id") != target.concept_id
            or not isinstance(resolved_graph, str)
            or resolved_graph not in self._authorized_graphs
        ):
            raise AuthorizationError("the resolved identity does not match the authorized target", operation=_AUTHORIZE)
        # The card's payload shape is trusted only after it matches the
        # contract: a drifted field must surface as a transient payload
        # defect, never as confident content or a raw validation error.
        body = card.get("body")
        if body is not None and not isinstance(body, str):
            raise TransientError("okf-server served a concept card whose body is not a string", operation=_AUTHORIZE)
        try:
            provenance = OkfConceptProvenance(
                concept_id=target.concept_id,
                repo_id=target.repo_id,
                bundle_version=card.get("bundle_version"),
            )
        except ValidationError as error:
            raise TransientError(
                f"okf-server served a concept card that does not match the contract: {error}",
                operation=_AUTHORIZE,
            ) from error
        return self._finalize_read(provenance, body or "", False, budget, empty_is_degradation=False)

    # -- deadline and result assembly -------------------------------------------

    async def _within_deadline(
        self, make_work: Callable[[], Awaitable], budget: OperationBudget, operation: OperationName
    ):
        """Run one operation under the budget's deadline: the contract's
        timeout semantics (stop without a partial result) as one owner.

        Bound note: ``asyncio.timeout`` cancels the await, not the worker —
        the sync drivers run in ``asyncio.to_thread``, whose work is
        uncancellable and outlives a breached deadline. The real bound on
        that work is each adapter's own per-call timeout (10 s by default),
        which is what keeps a burst of deadline breaches from pinning
        worker threads indefinitely.
        """
        try:
            async with asyncio.timeout(budget.timeout_ms / 1000):
                return await make_work()
        except TimeoutError as error:
            raise TransientError(f"{operation.value} exceeded its deadline", operation=operation) from error
        except ExceptionGroup as group:
            # The TaskGroup wraps a failing leg's exception; the contract's
            # carrier is the exception itself. A cancellation never enters
            # here (it is a BaseException and propagates untouched).
            if len(group.exceptions) == 1:
                raise group.exceptions[0] from None
            raise

    def _finalize_read(
        self,
        provenance: LegacyFileProvenance | OkfConceptProvenance,
        content: str,
        truncated: bool,
        budget: OperationBudget,
        *,
        empty_is_degradation: bool,
    ) -> ReadSourceResult:
        if not content and empty_is_degradation:
            # The legacy path: zero chunks means the corpus text is
            # unavailable (the file resolved but carries no readable text) —
            # degradation is reported as degradation, never as confident data
            # about the content. An OKF concept's empty body, by contrast, IS
            # the source's true content: the caller below reads it as a
            # successful read of an empty source.
            return ReadSourceResult(outcome=OutcomeCode.DEGRADED_AVAILABILITY, provenance=provenance, content=None)
        # The single result-size enforcement point (the contract assigns
        # TRUNCATE_AND_FLAG to the result scope): the chunk adapter bounded
        # only the chunk count, so the byte cut lives here for both paths.
        encoded = content.encode("utf-8")
        if len(encoded) > budget.max_result_bytes:
            content = encoded[: budget.max_result_bytes].decode("utf-8", "ignore")
            truncated = True
        return ReadSourceResult(
            outcome=OutcomeCode.SUCCESS, provenance=provenance, content=content, truncated=truncated
        )

    def _insufficient_read(self) -> ReadSourceResult:
        return ReadSourceResult(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE)

    def _insufficient_search(self, request: SearchKnowledgeInput) -> SearchKnowledgeResult:
        return SearchKnowledgeResult(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            query_preparation_status=request.query.preparation_status,
        )
