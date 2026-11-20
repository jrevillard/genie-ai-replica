# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The authorization executor — the port's enforcement point (story 1.7).

A contract declares; an executor enforces. The V04 map (§6) records which
obligations were declared by story 1.5 and enforced by nobody; this module
is where each of them becomes enforced:

* **Authorization precedes resolution.** A target outside the request's
  authorized set — or an identifier that fails its charset guard — is
  refused with ``AuthorizationError`` before doc-repo, okf-server or
  ArangoDB is contacted, so the refusal reveals nothing about the target's
  existence (no existence oracle).
* **Every resolved identity is re-validated.** What the adapters resolved
  must be what was authorized: a provenance that drifts from the request,
  or a resolved graph outside the set, fails closed — never a wider corpus.
* **The legacy corpus maps per AD-4.** A legacy ``file_id`` is in scope iff
  the request's authorized set includes the legacy graph. No per-user ACL
  exists on that corpus, and none is invented here.
* **The negative matrix covers search too.** The executor wraps the inner
  search port and drops every hit whose identity sits outside the set:
  restricted-graph content is not searchable, and an empty authorized set
  never reaches the inner port at all.
* **Per-request identity.** The executor is constructed with one request's
  trusted context; a call that arrives with any other context is refused.
  That is what invalidates retained-evidence reuse across a permission
  change between turns (FR-28) — the next turn's executor carries the next
  turn's set.

Failures keep the contract's carriers: authorization failure and transient
failure are raised, insufficiency and degraded availability are result
outcomes, and a cancellation propagates untouched.
"""

import asyncio

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
from capabilities.identifiers import validate_concept_id, validate_file_id, validate_graph_name, validate_repo_id

_AUTHORIZE = OperationName.READ_SOURCE
_SEARCH = OperationName.SEARCH_KNOWLEDGE


class AuthorizedExecutor:
    """Implements ``DocumentCapabilityPort`` by enforcing the caller context.

    Constructed per request with the context the BFF assembled, the caller's
    bearer (forwarded only to the services that validate their own callers)
    and the read adapters. The inner search port is injected: story 1.6's
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
        self._legacy_graph_name = validate_graph_name(legacy_graph_name, operation=_AUTHORIZE)
        self._authorized_repos = {repo.repo_id for repo in context.authorized_repos}
        self._docrepo = docrepo
        self._okf = okf
        self._chunks = chunks
        self._search_port = search_port

    async def search_knowledge(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
    ) -> SearchKnowledgeResult:
        """Search the authorized corpus; hits outside the set never surface."""
        self._refuse_a_foreign_context(context, operation=_SEARCH)
        if not context.authorized_graph_names:
            # Fail-closed: nothing is reachable, so nothing is sought. The
            # inner port is not consulted at all.
            return self._insufficient_search(request)
        try:
            async with asyncio.timeout(budget.timeout_ms / 1000):
                inner = await self._search_port.search_knowledge(context, request, budget)
        except TimeoutError as error:
            raise TransientError("search_knowledge exceeded its deadline", operation=_SEARCH) from error
        survivors = tuple(candidate for candidate in inner.hits if self._hit_is_authorized(candidate))
        if inner.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE or not survivors:
            return self._insufficient_search(request)
        truncated = inner.truncated or len(survivors) > budget.max_results
        return SearchKnowledgeResult(
            outcome=inner.outcome,
            hits=survivors[: budget.max_results],
            truncated=truncated,
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
        return self._legacy_graph_name in self._context.authorized_graph_names

    # -- the two read paths ---------------------------------------------------

    async def _read_legacy_file(self, file_id: str, budget: OperationBudget) -> ReadSourceResult:
        validate_file_id(file_id, operation=_AUTHORIZE)
        if self._legacy_graph_name not in self._context.authorized_graph_names:
            # AD-4: the legacy corpus has no per-user ACL — in scope only when
            # the set includes the legacy graph. Refused before doc-repo.
            raise AuthorizationError("the legacy corpus is not in the authorized set", operation=_AUTHORIZE)
        try:
            async with asyncio.timeout(budget.timeout_ms / 1000):
                metadata = await self._docrepo.fetch_metadata(file_id, self._bearer)
                if metadata is None:
                    return self._insufficient_read()
                content, truncated = await self._chunks.read_chunks(
                    self._legacy_graph_name, file_id, budget.max_results, budget.max_result_bytes
                )
        except TimeoutError as error:
            raise TransientError("read_source exceeded its deadline", operation=_AUTHORIZE) from error
        return self._finalize_read(
            LegacyFileProvenance(file_id=file_id), content, truncated, budget, empty_is_degradation=True
        )

    async def _read_okf_concept(self, target: OkfConceptRef, budget: OperationBudget) -> ReadSourceResult:
        validate_repo_id(target.repo_id, operation=_AUTHORIZE)
        validate_concept_id(target.concept_id, operation=_AUTHORIZE)
        if target.repo_id not in self._authorized_repos:
            raise AuthorizationError("the requested repository is not in the authorized set", operation=_AUTHORIZE)
        try:
            async with asyncio.timeout(budget.timeout_ms / 1000):
                card = await self._okf.fetch_concept(target.repo_id, target.concept_id, self._bearer)
        except TimeoutError as error:
            raise TransientError("read_source exceeded its deadline", operation=_AUTHORIZE) from error
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
            or resolved_graph not in self._context.authorized_graph_names
        ):
            raise AuthorizationError("the resolved identity does not match the authorized target", operation=_AUTHORIZE)
        provenance = OkfConceptProvenance(
            concept_id=target.concept_id,
            repo_id=target.repo_id,
            bundle_version=card.get("bundle_version"),
        )
        return self._finalize_read(provenance, str(card.get("body") or ""), False, budget, empty_is_degradation=False)

    # -- result assembly --------------------------------------------------------

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
