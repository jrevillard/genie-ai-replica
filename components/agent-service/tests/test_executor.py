# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The authorization executor: the negative authorization matrix.

The executor is the port's enforcement point: authorization precedes every
resolution, every resolved identity is re-validated, and nothing outside the
request's authorized set — read target or search hit — ever reaches the
caller.
"""

import asyncio

import pytest

from capabilities.contract import (
    AuthorizationError,
    AuthorizedRepo,
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OperationBudget,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchHit,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    TransientError,
)
from capabilities.executor import AuthorizedExecutor

BUDGET = OperationBudget(timeout_ms=2_000, max_results=5, max_result_bytes=10_000)
QUERY = SearchKnowledgeInput(query=PreparedQuery(text="q", preparation_status=QueryPreparationStatus.TRANSLATED))
DEFAULT_REPOS = (AuthorizedRepo(repo_id="r-1", graph_name="OKF_a_v1"),)


def ctx(graphs=("GRAPH", "OKF_a_v1"), repos=DEFAULT_REPOS, user="u-1"):
    return CallerContext(user_id=user, authorized_graph_names=graphs, authorized_repos=repos)


_UNSET = object()


class FakeDocRepo:
    def __init__(self, metadata=_UNSET, error=None):
        self.metadata = {"file_id": "42"} if metadata is _UNSET else metadata
        self.error = error
        self.calls = []

    async def fetch_metadata(self, file_id, bearer):
        self.calls.append({"file_id": file_id, "bearer": bearer})
        if self.error is not None:
            raise self.error
        return self.metadata


class FakeOkf:
    def __init__(self, card=None):
        self.card = card
        self.calls = []

    async def fetch_concept(self, repo_id, concept_id, bearer):
        self.calls.append({"repo_id": repo_id, "concept_id": concept_id, "bearer": bearer})
        return self.card


def okf_card(repo_id="r-1", concept_id="entities/google", graph_name="OKF_a_v1", body="the body"):
    return {
        "repo_id": repo_id,
        "concept_id": concept_id,
        "graph_name": graph_name,
        "bundle_version": 3,
        "title": "Google",
        "body": body,
    }


class FakeChunks:
    def __init__(self, content="chunk text", truncated=False):
        self.content = content
        self.truncated = truncated
        self.calls = []

    async def read_chunks(self, graph_name, file_id, max_chunks):
        self.calls.append({"graph_name": graph_name, "file_id": file_id})
        return self.content, self.truncated


class FakeSearchPort:
    """The inner port the executor wraps for search."""

    def __init__(self, result=None):
        self.result = result
        self.calls = []

    async def search_knowledge(self, context, request, budget, abstention_sink=None):
        self.calls.append({"context": context, "request": request, "budget": budget, "abstention_sink": abstention_sink})
        if self.result is None:
            if abstention_sink is not None:
                abstention_sink("no_documents_retrieved")
            return SearchKnowledgeResult(
                outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, query_preparation_status=QUERY.query.preparation_status
            )
        return self.result


def hit(prov):
    return SearchHit(provenance=prov, text="passage", score=1.0)


def executor(context=None, *, docrepo=None, okf=None, chunks=None, search=None, bearer="tok"):
    return AuthorizedExecutor(
        context if context is not None else ctx(),
        bearer=bearer,
        legacy_graph_name="GRAPH",
        docrepo=docrepo or FakeDocRepo(),
        okf=okf or FakeOkf(),
        chunks=chunks or FakeChunks(),
        search_port=search or FakeSearchPort(),
    )


def legacy_target(file_id="42"):
    from capabilities.contract import LegacyFileRef

    return ReadSourceInput(target=LegacyFileRef(file_id=file_id))


def okf_target(repo_id="r-1", concept_id="entities/google"):
    from capabilities.contract import OkfConceptRef

    return ReadSourceInput(target=OkfConceptRef(repo_id=repo_id, concept_id=concept_id))


# --- legacy read -----------------------------------------------------------


def test_legacy_read_authorized_succeeds_with_provenance_and_content():
    docrepo, chunks = FakeDocRepo(), FakeChunks(content="alpha beta")
    result = asyncio.run(executor(docrepo=docrepo, chunks=chunks).read_source(ctx(), legacy_target(), BUDGET))
    assert result.outcome is OutcomeCode.SUCCESS
    assert result.provenance == LegacyFileProvenance(file_id="42")
    assert result.content == "alpha beta"
    assert docrepo.calls[0]["file_id"] == "42"
    assert docrepo.calls[0]["bearer"] == "tok"
    assert chunks.calls == [{"graph_name": "GRAPH", "file_id": "42"}]


def test_legacy_read_unauthorized_refuses_before_any_resolution():
    """The executor carries the narrow context itself, so the context gate
    passes and the legacy-graph membership check is what refuses —
    a deleted membership check must turn this test red."""
    docrepo, chunks = FakeDocRepo(), FakeChunks()
    narrow = ctx(graphs=("OKF_a_v1",), repos=(AuthorizedRepo(repo_id="r-1", graph_name="OKF_a_v1"),))
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(narrow, docrepo=docrepo, chunks=chunks).read_source(narrow, legacy_target(), BUDGET))
    assert docrepo.calls == [] and chunks.calls == []


def test_legacy_read_unknown_file_is_an_insufficiency():
    result = asyncio.run(executor(docrepo=FakeDocRepo(metadata=None)).read_source(ctx(), legacy_target(), BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.provenance is None and result.content is None


def test_legacy_read_resolved_but_empty_corpus_is_degraded():
    result = asyncio.run(
        executor(docrepo=FakeDocRepo(), chunks=FakeChunks(content="")).read_source(ctx(), legacy_target(), BUDGET)
    )
    assert result.outcome is OutcomeCode.DEGRADED_AVAILABILITY
    assert result.provenance == LegacyFileProvenance(file_id="42")
    assert result.content is None


def test_legacy_read_downstream_failure_is_transient():
    with pytest.raises(TransientError):
        asyncio.run(
            executor(docrepo=FakeDocRepo(error=TransientError("down"))).read_source(ctx(), legacy_target(), BUDGET)
        )


# --- OKF read --------------------------------------------------------------


def test_okf_read_authorized_succeeds_with_the_provenance_trio():
    result = asyncio.run(executor(okf=FakeOkf(okf_card())).read_source(ctx(), okf_target(), BUDGET))
    assert result.outcome is OutcomeCode.SUCCESS
    assert result.provenance == OkfConceptProvenance(concept_id="entities/google", repo_id="r-1", bundle_version=3)
    assert result.content == "the body"


def test_okf_read_unauthorized_repo_refuses_before_any_resolution():
    """The executor carries the other user's context, so the repo-membership
    check is what refuses — a deleted membership check must turn this red."""
    okf = FakeOkf(okf_card())
    other_user = ctx(graphs=("OKF_b_v1",), repos=(AuthorizedRepo(repo_id="r-9", graph_name="OKF_b_v1"),))
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(other_user, okf=okf).read_source(other_user, okf_target(), BUDGET))
    assert okf.calls == []


def test_okf_read_unresolvable_is_an_insufficiency():
    result = asyncio.run(executor(okf=FakeOkf(None)).read_source(ctx(), okf_target(), BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.provenance is None and result.content is None


def test_okf_read_empty_body_is_a_successful_read_of_an_empty_source():
    """An empty body is the source's true content — a fact, not a failed
    fetch. Only the legacy path treats an empty content as degradation
    (zero chunks means the corpus text is unavailable, not empty)."""
    result = asyncio.run(executor(okf=FakeOkf(okf_card(body=""))).read_source(ctx(), okf_target(), BUDGET))
    assert result.outcome is OutcomeCode.SUCCESS
    assert result.provenance is not None and result.content == ""


def test_okf_read_identity_drift_fails_closed():
    drifted = okf_card(repo_id="r-2", graph_name="OKF_a_v1")
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(okf=FakeOkf(drifted)).read_source(ctx(), okf_target(), BUDGET))


def test_okf_read_graph_outside_the_set_fails_closed():
    drifted = okf_card(repo_id="r-1", graph_name="OKF_secret_v1")
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(okf=FakeOkf(drifted)).read_source(ctx(), okf_target(), BUDGET))


def test_okf_bundle_version_nullable_is_carried():
    card = okf_card()
    card["bundle_version"] = None
    result = asyncio.run(executor(okf=FakeOkf(card)).read_source(ctx(), okf_target(), BUDGET))
    assert result.provenance == OkfConceptProvenance(concept_id="entities/google", repo_id="r-1", bundle_version=None)


# --- the refusal is refusal-shaped everywhere ------------------------------


@pytest.mark.parametrize(
    "target",
    [
        ReadSourceInput.model_validate({"target": {"file_id": "abc;drop"}}),
        ReadSourceInput.model_validate({"target": {"repo_id": "a`b", "concept_id": "c"}}),
        ReadSourceInput.model_validate({"target": {"repo_id": "r-1", "concept_id": "a b"}}),
    ],
)
def test_charset_violations_refuse_before_any_resolution(target):
    docrepo, okf = FakeDocRepo(), FakeOkf(okf_card())
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(docrepo=docrepo, okf=okf).read_source(ctx(), target, BUDGET))
    assert docrepo.calls == [] and okf.calls == []


def test_cross_user_and_cross_session_attempts_refuse():
    other = ctx(graphs=("OKF_b_v1",), repos=(AuthorizedRepo(repo_id="r-9", graph_name="OKF_b_v1"),), user="u-2")
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(other).read_source(other, okf_target(), BUDGET))


def test_permission_change_between_turns_invalidates_retained_evidence():
    """The same target authorized at turn N is refused at turn N+1.
    Turn N+1's executor carries turn N+1's own (narrower) context, so the
    membership check — not the context gate — is what refuses the re-read."""
    docrepo = FakeDocRepo()
    turn_one = executor(docrepo=docrepo)
    first = asyncio.run(turn_one.read_source(ctx(), legacy_target(), BUDGET))
    assert first.outcome is OutcomeCode.SUCCESS
    turn_two_ctx = ctx(graphs=("OKF_a_v1",), repos=(AuthorizedRepo(repo_id="r-1", graph_name="OKF_a_v1"),))
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(turn_two_ctx, docrepo=docrepo).read_source(turn_two_ctx, legacy_target(), BUDGET))


def test_a_swapped_context_is_refused():
    wider = ctx(graphs=("GRAPH", "OKF_a_v1", "OKF_secret_v9"))
    with pytest.raises(AuthorizationError):
        asyncio.run(executor(context=ctx()).read_source(wider, legacy_target(), BUDGET))


# --- search enforcement ----------------------------------------------------


def test_search_with_an_empty_authorized_set_never_reaches_the_inner_port():
    inner = FakeSearchPort()
    empty = ctx(graphs=(), repos=())
    result = asyncio.run(executor(empty, search=inner).search_knowledge(empty, QUERY, BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    assert inner.calls == []


def test_search_restricted_graph_content_is_not_searchable():
    """Every hit whose identity sits outside the authorized set is dropped."""
    inner = FakeSearchPort(
        SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=(hit(OkfConceptProvenance(concept_id="c", repo_id="r-secret", bundle_version=None)),),
            query_preparation_status=QUERY.query.preparation_status,
        )
    )
    result = asyncio.run(executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.hits == ()


def test_search_keeps_only_authorized_hits():
    inner = FakeSearchPort(
        SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=(
                hit(OkfConceptProvenance(concept_id="c1", repo_id="r-1", bundle_version=None)),
                hit(OkfConceptProvenance(concept_id="c2", repo_id="r-secret", bundle_version=None)),
                hit(LegacyFileProvenance(file_id="42")),
                hit(LegacyFileProvenance(file_id="999")),  # legacy: in-scope iff legacy graph in set — it is
            ),
            query_preparation_status=QUERY.query.preparation_status,
        )
    )
    result = asyncio.run(executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET))
    assert result.outcome is OutcomeCode.SUCCESS
    assert len(result.hits) == 3


def test_search_legacy_hits_refused_when_the_legacy_graph_is_absent():
    inner = FakeSearchPort(
        SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=(hit(LegacyFileProvenance(file_id="42")),),
            query_preparation_status=QUERY.query.preparation_status,
        )
    )
    okf_only = ctx(graphs=("OKF_a_v1",), repos=(AuthorizedRepo(repo_id="r-1", graph_name="OKF_a_v1"),))
    result = asyncio.run(executor(okf_only, search=inner).search_knowledge(okf_only, QUERY, BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE


def test_search_insufficiency_passes_through():
    inner = FakeSearchPort()
    result = asyncio.run(executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET))
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE


def test_search_threads_the_abstention_sink_into_the_inner_port():
    """The recorded insufficiency reason survives the executor boundary: the
    agent path's search carries the same per-call sink hook the direct
    capability path takes, so an insufficiency answered through the
    executor records its exact reason — the same event the direct path
    (config B) records, not a null reason beside it."""
    reasons = []
    inner = FakeSearchPort()
    result = asyncio.run(
        executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET, abstention_sink=reasons.append)
    )
    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    # The sink travelled WITH the call to the inner port...
    assert inner.calls[-1]["abstention_sink"] is not None
    # ...and the inner port's recorded reason reached the caller's sink.
    assert reasons == ["no_documents_retrieved"]


def test_search_without_a_sink_leaves_the_inner_call_unchanged():
    """No sink passed: the inner port sees none — the executor's protocol
    call stays a plain call for callers that scrape no reasons."""
    inner = FakeSearchPort()
    asyncio.run(executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET))
    assert inner.calls[-1]["abstention_sink"] is None


def test_search_hit_cap_truncates():
    """The hit cap is the inner port's OWN result budget (it caps `hits` at
    max_results before the executor sees them) — the executor slices its
    authorized survivors to the same cap and reports the inner port's
    truncation honesty. A second truncation count here would be a cut that
    never happens."""
    hits = tuple(hit(LegacyFileProvenance(file_id=str(i))) for i in range(10))
    inner = FakeSearchPort(
        SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=hits,
            truncated=True,
            query_preparation_status=QUERY.query.preparation_status,
        )
    )
    result = asyncio.run(executor(search=inner).search_knowledge(ctx(), QUERY, BUDGET))
    assert result.outcome is OutcomeCode.SUCCESS
    assert len(result.hits) == BUDGET.max_results
    assert result.truncated is True


# --- limits ----------------------------------------------------------------


def test_timeout_breach_is_transient():
    class SlowChunks(FakeChunks):
        async def read_chunks(self, graph_name, file_id, max_chunks):
            await asyncio.sleep(1)
            return "x", False

    with pytest.raises(TransientError):
        asyncio.run(
            executor(chunks=SlowChunks()).read_source(
                ctx(), legacy_target(), OperationBudget(timeout_ms=10, max_results=5, max_result_bytes=100)
            )
        )


def test_content_over_budget_truncates_and_flags():
    result = asyncio.run(
        executor(chunks=FakeChunks(content="0123456789" * 100)).read_source(
            ctx(), legacy_target(), OperationBudget(timeout_ms=1_000, max_results=5, max_result_bytes=64)
        )
    )
    assert result.outcome is OutcomeCode.SUCCESS
    assert len(result.content) == 64
    assert result.truncated is True


def test_cancellation_propagates_untouched():
    async def cancelled_read():
        loop = asyncio.get_running_loop()
        task = loop.create_task(
            executor(docrepo=FakeDocRepo(metadata=None)).read_source(ctx(), legacy_target(), BUDGET)
        )
        task.cancel()
        await task

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(cancelled_read())


def test_a_bad_legacy_graph_name_is_a_configuration_error_not_a_refusal():
    """ARANGO_GRAPH_NAME is deployment configuration: a bad value fails at
    construction with a ValueError — an operator defect — and never as a
    caller-facing authorization failure."""
    with pytest.raises(ValueError):
        AuthorizedExecutor(
            ctx(),
            bearer=None,
            legacy_graph_name="bad name; DROP",
            docrepo=FakeDocRepo(),
            okf=FakeOkf(),
            chunks=FakeChunks(),
            search_port=FakeSearchPort(),
        )


def test_okf_card_with_a_non_string_body_is_transient_not_confident_garbage():
    """A payload drift that arrives as structured JSON must not be str()-ed
    into confident SUCCESS content."""
    card = okf_card(body={"en": "structured drift"})
    with pytest.raises(TransientError):
        asyncio.run(executor(okf=FakeOkf(card)).read_source(ctx(), okf_target(), BUDGET))


def test_okf_card_with_an_uncoercible_bundle_version_is_transient():
    """A card whose bundle_version cannot carry the identity fails as a
    transient payload defect — a raw pydantic error would escape the
    contract's carriers."""
    card = okf_card()
    card["bundle_version"] = "not-a-version"
    with pytest.raises(TransientError):
        asyncio.run(executor(okf=FakeOkf(card)).read_source(ctx(), okf_target(), BUDGET))
