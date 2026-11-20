# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``search_knowledge`` port: outcome mapping, budget, and the contract seam.

The recorded empty cases stay distinct (V02 §4.13/§4.14) and map onto the
accepted contract surface (story 1.5: every empty case is an
``insufficient_evidence`` answer); the budget and cancellation declarations
behave per the contract's limit semantics.
"""

import asyncio

import pytest
from pydantic import ValidationError

from capabilities.adapters.env_config import ArangoConfig, HybridConfig, RerankingConfig
from capabilities.adapters.tei_embedding import EmbeddedQuery
from capabilities.adapters.tei_reranking import RerankerInputTooLongError, RerankOutcome, ScoredCandidate
from capabilities.contract import (
    AuthorizationError,
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OperationBudget,
    OperationName,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    SearchKnowledgeInput,
    TransientError,
)
from capabilities.search_knowledge import SearchKnowledgeCapability

BUDGET = OperationBudget(timeout_ms=5000, max_results=5, max_result_bytes=1_000_000)


def context(graphs=("GRAPH",), labels=()):
    return CallerContext(
        user_id="u1",
        authorized_graph_names=tuple(graphs),
        authorized_repos=(),
        requested_labels=tuple(labels),
    )


def prepared(text="What is the retirement age?", status=QueryPreparationStatus.TRANSLATED):
    return SearchKnowledgeInput(query=PreparedQuery(text=text, preparation_status=status))


class FakeEmbedding:
    """Embeds by returning the recorded instruction shape and a fixed vector."""

    def __init__(self, fail=False):
        self.fail = fail
        self.last_raw = None

    async def embed(self, text):
        if self.fail:
            raise RuntimeError("embedder down")
        self.last_raw = text
        return EmbeddedQuery(
            raw_text=text,
            prefixed_text="Represent this sentence for searching relevant passages: " + text,
            embedding=[0.1, 0.2],
        )


class FakeReranking:
    def __init__(self, outcome=None, error=None):
        self.outcome = outcome
        self.error = error
        self.calls = []

    async def rerank(self, query, texts, chunk_embeddings=None, query_embedding=None):
        self.calls.append((query, list(texts)))
        if self.error is not None:
            raise self.error
        return self.outcome


class FakeDbFactory:
    """One adapter per graph; records which graphs were searched."""

    def __init__(self, rows=None):
        self.graphs = []
        self.rows = rows or []

    def __call__(self, graph_name):

        self.graphs.append(graph_name)
        return _FakeDb(self.rows)


class _RowsAql:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, aql, bind_vars=None, **kwargs):
        rows = self._rows

        class C:
            def __iter__(self):
                return iter(rows)

        return C()


class _FakeDb:
    def __init__(self, rows):
        self.aql = _RowsAql(rows)

    def views(self):
        return [{"name": "GRAPH_BM25_VIEW"}]


def make_capability(embedding=None, reranking=None, rows=None):
    rows = rows or []
    embedding = embedding or FakeEmbedding()
    reranking = reranking or FakeReranking(outcome=RerankOutcome(selection=()))
    db_factory = FakeDbFactory(rows=rows)
    capability = SearchKnowledgeCapability(
        embedding,
        reranking,
        db_factory,
        ArangoConfig.load({"ARANGO_GRAPH_NAME": "GRAPH", "ARANGO_DB": "_system"}),
        HybridConfig.load({}),
    )
    return capability, embedding, reranking, db_factory


# ---------------------------------------------------------------------
# The contract seam
# ---------------------------------------------------------------------


def test_non_prepared_query_is_refused_by_the_contract_before_execution():
    with pytest.raises(ValidationError):
        prepared(status=QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE)
    with pytest.raises(ValidationError):
        prepared(status=QueryPreparationStatus.FALLBACK_TIMEOUT)
    with pytest.raises(ValidationError):
        prepared(status=QueryPreparationStatus.FALLBACK_ERROR)


def test_empty_authorized_set_is_an_authorization_failure():
    capability, _e, _r, _f = make_capability()
    with pytest.raises(AuthorizationError):
        asyncio.run(capability.search_knowledge(context(graphs=()), prepared(), BUDGET))


def test_invalid_graph_name_is_refused_before_any_query():
    capability, _e, _r, db_factory = make_capability()
    with pytest.raises(ValueError, match="Invalid graph name"):
        asyncio.run(capability.search_knowledge(context(graphs=("GRAPH}; DROP",)), prepared(), BUDGET))
    assert db_factory.graphs == []


# ---------------------------------------------------------------------
# The recorded empty cases, kept distinct on the contract surface
# ---------------------------------------------------------------------


def test_empty_retrieval_is_insufficient_evidence_with_no_documents_retrieved(caplog):
    reranking = FakeReranking(outcome=RerankOutcome(selection=()))
    capability, _e, _r, _f = make_capability(reranking=reranking)
    with caplog.at_level("WARNING"):
        result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.hits == ()
    assert any("no_documents_retrieved" in record.message for record in caplog.records)
    # The reranker was never called: nothing to rerank.
    assert reranking.calls == []


def test_empty_selection_is_insufficient_evidence_with_reranker_selected_nothing(caplog):
    rows = [{"key": "c1", "text": "a", "score": 0.9, "file_id": None}]
    reranking = FakeReranking(outcome=RerankOutcome(selection=()))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    with caplog.at_level("WARNING"):
        result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE
    assert any("reranker_selected_nothing" in record.message for record in caplog.records)
    # Distinct reasons: the two abstentions never share a log signature.
    assert not any("no_documents_retrieved" in record.message for record in caplog.records)


def test_reranker_input_too_long_is_insufficient_evidence_with_the_recorded_reason(caplog):
    rows = [{"key": "c1", "text": "a", "score": 0.9, "file_id": None}]
    reranking = FakeReranking(error=RerankerInputTooLongError("TEI rejected input"))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    with caplog.at_level("INFO"):
        result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.hits == ()
    assert any("reranker_input_too_long" in record.message for record in caplog.records)
    assert any("data ingestion issue" in record.message for record in caplog.records)


# ---------------------------------------------------------------------
# Success mapping: order, provenance, enrichment
# ---------------------------------------------------------------------


def test_success_keeps_the_reranker_score_descending_order_and_scores():
    rows = [
        {"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"},
        {"key": "c2", "text": "beta", "score": 0.5, "file_id": "f2"},
    ]
    selection = (
        ScoredCandidate(text="beta", score=0.6, position=1),
        ScoredCandidate(text="alpha", score=0.7, position=0),
    )
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.SUCCESS
    assert [hit.score for hit in result.hits] == [0.6, 0.7]  # TEI's order, not retrieval's
    assert [hit.text for hit in result.hits] == ["beta", "alpha"]
    assert result.truncated is False
    assert result.query_preparation_status == QueryPreparationStatus.TRANSLATED


def test_cap1_resolved_candidate_carries_okf_provenance_and_unresolved_carries_legacy():
    rows_file_id = [
        {"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"},
        {"key": "c2", "text": "beta", "score": 0.5, "file_id": "f2"},
    ]
    rows_identity = [{"key": "c1", "repo_id": "repo-1", "bundle_version": 7}]
    selection = (
        ScoredCandidate(text="alpha", score=0.7, position=0),
        ScoredCandidate(text="beta", score=0.6, position=1),
    )
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))

    class SplitAql:
        def execute(self, aql, bind_vars=None, **kwargs):
            rows = rows_identity if "okf_concepts_meta" in aql else rows_file_id

            class C:
                def __iter__(self):
                    return iter(rows)

            return C()

    class SplitDb:
        def __init__(self):
            self.aql = SplitAql()

        def views(self):
            return [{"name": "GRAPH_BM25_VIEW"}]

    capability, _e, _r, _f = make_capability(reranking=reranking)
    capability._db_factory = lambda graph: SplitDb()
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert isinstance(result.hits[0].provenance, OkfConceptProvenance)
    assert result.hits[0].provenance.concept_id == "f1"
    assert result.hits[0].provenance.repo_id == "repo-1"
    assert result.hits[0].provenance.bundle_version == 7
    assert isinstance(result.hits[1].provenance, LegacyFileProvenance)
    assert result.hits[1].provenance.file_id == "f2"


def test_candidate_without_file_id_serves_unattributed_with_empty_id():
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": None}]
    selection = (ScoredCandidate(text="alpha", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert isinstance(result.hits[0].provenance, LegacyFileProvenance)
    assert result.hits[0].provenance.file_id == ""  # the recorded unattributed chunk


def test_raw_text_goes_to_the_bm25_side_and_prefixed_to_the_embedder():
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    selection = (ScoredCandidate(text="alpha", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    embedding = FakeEmbedding()
    capability, embedding, reranking, _f = make_capability(embedding=embedding, reranking=reranking, rows=rows)
    asyncio.run(capability.search_knowledge(context(), prepared(text="Dubai transport"), BUDGET))
    assert embedding.last_raw == "Dubai transport"
    # The reranker query is the RAW retrieval query (V02: TEI receives the
    # query, not the prefixed embedding input).
    assert reranking.calls[0][0] == "Dubai transport"


def test_multi_graph_search_addresses_every_authorized_graph_and_merges_candidates():
    """Each leg queries ITS OWN graph: the collection, the BM25 view and the
    CAP-1 bind derive from the context's graph name, never from the env
    default — the second graph's corpus is searched and no chunk is
    duplicated into the union."""

    class GraphRecordingAql:
        """The dense leg answers only when asked about its own collection."""

        def __init__(self, graph):
            self._graph = graph
            GraphRecordingAql.searched.add(graph)

        searched: set = set()

        def execute(self, aql, bind_vars=None, **kwargs):
            if "@collection" in aql:
                collection = bind_vars["@collection"]
                assert collection == f"{self._graph}_SOURCE", (collection, self._graph)
            if "okf_concepts_meta" in aql:
                assert bind_vars["graph_name"] == self._graph
            if "COSINE_SIMILARITY" in aql:
                rows = [{"key": f"{self._graph}-c1", "text": f"from-{self._graph}", "score": 0.9, "file_id": "f1"}]
            else:
                rows = []

            class C:
                def __iter__(self):
                    return iter(rows)

            return C()

    class GraphDb:
        def __init__(self, graph):
            self.aql = GraphRecordingAql(graph)

        def views(self):
            return [{"name": "GRAPH_BM25_VIEW"}]

    selection = (
        ScoredCandidate(text="from-GRAPH", score=0.7, position=0),
        ScoredCandidate(text="from-OKF_gov_v1", score=0.6, position=1),
    )
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, db_factory = make_capability(reranking=reranking)
    capability._db_factory = lambda graph: GraphDb(graph)
    result = asyncio.run(capability.search_knowledge(context(graphs=("GRAPH", "OKF_gov_v1")), prepared(), BUDGET))
    assert GraphRecordingAql.searched == {"GRAPH", "OKF_gov_v1"}  # BOTH collections queried
    assert len(result.hits) == 2  # one hit per graph — no duplicated chunk
    assert reranking.calls[0][1] == ["from-GRAPH", "from-OKF_gov_v1"]


def test_second_authorized_graph_gets_its_own_view_and_join_names():
    """The BM25 view and the CAP-1 bind of the second leg name the SECOND
    graph, not the env's ARANGO_GRAPH_NAME."""
    seen: list[tuple[str, dict]] = []

    class RecordingDb:
        def __init__(self, graph):
            self.graph = graph

        def views(self):
            return [{"name": "GRAPH_BM25_VIEW"}]

        class aql:
            pass

    def make_db(graph):
        db = RecordingDb(graph)

        def execute(aql, bind_vars=None, **kwargs):
            seen.append((aql, dict(bind_vars or {})))
            rows = []
            if "COSINE_SIMILARITY" in aql:
                rows = [{"key": "c1", "text": "t", "score": 0.9, "file_id": "f1"}]

            class C:
                def __iter__(self):
                    return iter(rows)

            return C()

        db.aql.execute = execute
        return db

    selection = (ScoredCandidate(text="t", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=[{"key": "c1", "text": "t", "score": 0.9}])
    capability._db_factory = make_db
    asyncio.run(capability.search_knowledge(context(graphs=("GRAPH", "OTHER_g")), prepared(), BUDGET))
    view_queries = [aql for aql, _ in seen if "BM25_VIEW" in aql]
    assert len(view_queries) == 2
    assert "`OTHER_g_BM25_VIEW`" in view_queries[1]  # the second leg's own view
    identity_binds = [b for aql, b in seen if "okf_concepts_meta" in aql]
    assert identity_binds[1]["graph_name"] == "OTHER_g"  # the second leg's own join


# ---------------------------------------------------------------------
# Degradation mapping
# ---------------------------------------------------------------------


def _capability_with_degraded_adapter(monkeypatch, flag: str):
    """A capability whose retrieval adapter reports one recorded degradation.

    The adapter instance is built per leg inside _run; the constructor is
    patched for the duration of the test (monkeypatch undoes it)."""
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    selection = (ScoredCandidate(text="alpha", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)

    import capabilities.adapters.arango_retrieval as module

    original_init = module.ArangoRetrievalAdapter.__init__

    def init_with_degradation(self, db, arango_config, hybrid_config, **kwargs):
        original_init(self, db, arango_config, hybrid_config, **kwargs)
        setattr(self, flag, True)

    monkeypatch.setattr(module.ArangoRetrievalAdapter, "__init__", init_with_degradation)
    return capability


def test_cap1_degradation_with_hits_is_degraded_availability(monkeypatch):
    capability = _capability_with_degraded_adapter(monkeypatch, "cap1_degraded")
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.DEGRADED_AVAILABILITY
    assert len(result.hits) == 1


def test_bm25_failure_with_hits_is_degraded_availability(monkeypatch):
    capability = _capability_with_degraded_adapter(monkeypatch, "bm25_degraded")
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.DEGRADED_AVAILABILITY
    assert len(result.hits) == 1


# ---------------------------------------------------------------------
# Failure mapping: transient
# ---------------------------------------------------------------------


def test_embedding_failure_is_transient():
    embedding = FakeEmbedding(fail=True)
    capability, _e, _r, _f = make_capability(embedding=embedding)
    with pytest.raises(TransientError):
        asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))


def test_reranker_transport_failure_is_transient_with_no_fallback():
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    reranking = FakeReranking(error=RuntimeError("TEI reranker call failed: HTTP 500"))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    with pytest.raises(TransientError):
        asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))


def test_file_id_enrichment_failure_is_transient():
    class ExplodingAql:
        def execute(self, aql, bind_vars=None, **kwargs):
            if "doc._key IN @chunk_ids" in aql and "okf_concepts_meta" not in aql:
                raise RuntimeError("db down")
            rows = [{"key": "c1", "text": "alpha", "score": 0.9}] if "COSINE_SIMILARITY" in aql else []

            class C:
                def __iter__(self):
                    return iter(rows)

            return C()

    class Db:
        def __init__(self):
            self.aql = ExplodingAql()

        def views(self):
            return [{"name": "GRAPH_BM25_VIEW"}]

    capability, _e, _r, _f = make_capability()
    capability._db_factory = lambda graph: Db()
    with pytest.raises(TransientError):
        asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))


# ---------------------------------------------------------------------
# The budget: timeout, result size, cancellation
# ---------------------------------------------------------------------


def test_budget_timeout_is_transient_without_partial_results():
    class SlowReranking:
        async def rerank(self, query, texts, chunk_embeddings=None, query_embedding=None):
            await asyncio.sleep(10)

    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    capability, _e, _r, _f = make_capability(reranking=SlowReranking(), rows=rows)
    budget = OperationBudget(timeout_ms=100, max_results=5, max_result_bytes=1_000_000)
    with pytest.raises(TransientError, match="budget"):
        asyncio.run(capability.search_knowledge(context(), prepared(), budget))


def test_max_results_truncates_and_flags():
    rows = [{"key": f"c{i}", "text": f"t{i}", "score": 0.9 - i / 100, "file_id": f"f{i}"} for i in range(4)]
    selection = tuple(ScoredCandidate(text=f"t{i}", score=0.9 - i / 100, position=i) for i in range(4))
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    budget = OperationBudget(timeout_ms=5000, max_results=2, max_result_bytes=1_000_000)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), budget))
    assert result.truncated is True
    assert len(result.hits) == 2


def test_max_result_bytes_truncates_and_flags():
    rows = [
        {"key": "c1", "text": "x" * 1000, "score": 0.9, "file_id": "f1"},
        {"key": "c2", "text": "y" * 1000, "score": 0.8, "file_id": "f2"},
    ]
    selection = (
        ScoredCandidate(text="x" * 1000, score=0.9, position=0),
        ScoredCandidate(text="y" * 1000, score=0.8, position=1),
    )
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    budget = OperationBudget(timeout_ms=5000, max_results=5, max_result_bytes=1200)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), budget))
    assert result.truncated is True
    assert len(result.hits) == 1


def test_cancellation_propagates_unchanged():
    class SlowReranking:
        async def rerank(self, query, texts, chunk_embeddings=None, query_embedding=None):
            await asyncio.sleep(10)

    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    capability, _e, _r, _f = make_capability(reranking=SlowReranking(), rows=rows)

    async def cancel_midflight():
        task = asyncio.ensure_future(capability.search_knowledge(context(), prepared(), BUDGET))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return "cancelled"
        return "completed"

    assert asyncio.run(cancel_midflight()) == "cancelled"


# ---------------------------------------------------------------------
# Review-round-1 regressions
# ---------------------------------------------------------------------


def test_budget_tighter_than_one_hit_yields_insufficiency_not_a_validation_error():
    """A max_result_bytes smaller than one hit truncates the result empty —
    the answer is an insufficiency (truncated=True), never an empty SUCCESS
    (which the contract validator would reject)."""
    rows = [{"key": "c1", "text": "x" * 1000, "score": 0.9, "file_id": "f1"}]
    selection = (ScoredCandidate(text="x" * 1000, score=0.9, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    budget = OperationBudget(timeout_ms=5000, max_results=5, max_result_bytes=10)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), budget))
    assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.hits == ()
    assert result.truncated is True


def test_configured_adaptive_strategy_reranks_with_threaded_embeddings(monkeypatch):
    """RERANKING_STRATEGY=adaptive works end to end: the dense leg's chunk
    embeddings and the query embedding are threaded into the reranker."""
    from capabilities.adapters.tei_reranking import TeiRerankingAdapter

    rows = [
        {"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1", "embedding": [1.0, 0.0]},
        {"key": "c2", "text": "beta", "score": 0.5, "file_id": "f2", "embedding": [0.0, 1.0]},
    ]
    seen_kwargs = {}

    class RecordingReranker(TeiRerankingAdapter):
        def __init__(self):
            super().__init__(
                "https://tei.invalid",
                RerankingConfig(
                    strategy="slice",
                    threshold=0.75,
                    top_n=3,
                    calibration="none",
                    temperature=1.0,
                    rerank_timeout_seconds=300.0,
                    connect_timeout_seconds=30.0,
                ),
            )

        async def rerank(self, query, texts, chunk_embeddings=None, query_embedding=None):
            seen_kwargs["chunk_embeddings"] = chunk_embeddings
            seen_kwargs["query_embedding"] = query_embedding
            from capabilities.adapters.tei_reranking import RerankOutcome, ScoredCandidate

            return RerankOutcome(selection=(ScoredCandidate(text="alpha", score=0.9, position=0),))

    capability, _e, _r, _f = make_capability(reranking=RecordingReranker(), rows=rows)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.SUCCESS
    assert seen_kwargs["query_embedding"] == [0.1, 0.2]
    assert seen_kwargs["chunk_embeddings"] == [[1.0, 0.0], [0.0, 1.0]]


def test_bm25_rescued_candidate_misaligns_adaptive_and_fails_transient():
    """A fusion-rescued candidate carries no embedding: adaptive's validity
    check fails and the search fails transiently — the recorded hard-fail."""
    from capabilities.adapters.tei_reranking import TeiRerankingAdapter

    class AdaptiveReranker(TeiRerankingAdapter):
        def __init__(self):
            super().__init__(
                "https://tei.invalid",
                RerankingConfig(
                    strategy="adaptive",
                    threshold=0.75,
                    top_n=3,
                    calibration="none",
                    temperature=1.0,
                    rerank_timeout_seconds=300.0,
                    connect_timeout_seconds=30.0,
                ),
            )

        async def rerank(self, query, texts, chunk_embeddings=None, query_embedding=None):
            # Skip the HTTP hop: run the REAL adaptive selection over a canned
            # score-descending TEI response — the hard-fail under test is in
            # the selection logic, not in the transport.
            decoded = [{"index": i, "score": 0.9} for i in range(len(texts))]
            selection = self._select(decoded, texts, "adaptive", chunk_embeddings, query_embedding)
            return RerankOutcome(selection=tuple(selection))

    bm25_only = [{"key": "c9", "text": "rescued", "chunk_labels": None, "score": 5.0, "file_id": None}]
    capability, _e, _r, _f = make_capability(rows=bm25_only)
    capability._reranking = AdaptiveReranker()
    with pytest.raises(TransientError, match="ADAPTIVE"):
        asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))


def test_bm25_view_cache_spans_requests():
    """The ensured-view cache lives on the capability: the second request's
    adapter inherits it and lists views() again but creates nothing new."""
    created: list[str] = []

    class CacheDb:
        def __init__(self, known):
            self.known = known

        def views(self):
            return [{"name": n} for n in self.known]

        def create_arangosearch_view(self, name, properties):
            created.append(name)
            self.known.add(name)

        class aql:
            @classmethod
            def execute(cls, aql, bind_vars=None, **kwargs):
                rows = [{"key": "c1", "text": "t", "score": 0.9, "file_id": "f1"}]

                class C:
                    def __iter__(self):
                        return iter(rows)

                return C()

    rows = [{"key": "c1", "text": "t", "score": 0.9}]
    selection = (ScoredCandidate(text="t", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    known_views = set()
    capability._db_factory = lambda graph: CacheDb(known_views)
    asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    # The view is created once across the two requests, never twice.
    assert len(created) == 1


def test_embedding_budget_uses_the_embed_knobs_not_the_rerank_ones(monkeypatch):
    env = {
        "ARANGO_URL": "http://localhost:8529",
        "TEI_EMBEDDING_ENDPOINT": "https://tei.invalid/embed",
        "TEI_RERANKING_ENDPOINT": "https://tei.invalid",
        "MODEL_HUB_EMBED_TIMEOUT_SECONDS": "123.0",
        "MODEL_RERANK_TIMEOUT_SECONDS": "77.0",
    }
    monkeypatch.setattr(
        "arango.ArangoClient",
        lambda hosts: type("C", (), {"db": lambda self, *a, **k: None})(),
    )
    capability = SearchKnowledgeCapability.create(env)
    assert capability._embedding._total_timeout == 123.0
    assert capability._embedding._connect_timeout == 30.0


# ---------------------------------------------------------------------
# Boot assembly
# ---------------------------------------------------------------------


def test_create_requires_both_model_endpoints():
    from capabilities.search_knowledge import SearchKnowledgeCapability as Cap

    env = {"ARANGO_URL": "http://localhost:8529", "TEI_EMBEDDING_ENDPOINT": ""}
    with pytest.raises(ValueError, match="TEI_EMBEDDING_ENDPOINT"):
        Cap.create(env)
    env = {"ARANGO_URL": "http://localhost:8529", "TEI_EMBEDDING_ENDPOINT": "https://tei/embed"}
    with pytest.raises(ValueError, match="TEI_RERANKING_ENDPOINT"):
        Cap.create(env)


def test_create_wires_the_contract_surface(monkeypatch):
    """The assembled capability realizes the contract's port signature."""
    env = {
        "ARANGO_URL": "http://localhost:8529",
        "ARANGO_DB": "_system",
        "ARANGO_GRAPH_NAME": "GRAPH",
        "TEI_EMBEDDING_ENDPOINT": "https://tei.invalid/embed",
        "TEI_RERANKING_ENDPOINT": "https://tei.invalid",
    }
    monkeypatch.setattr(
        "arango.ArangoClient",
        lambda hosts: type("C", (), {"db": lambda self, *a, **k: None})(),
    )
    capability = SearchKnowledgeCapability.create(env)
    assert capability.name == OperationName.SEARCH_KNOWLEDGE
    # The port interface is satisfied: search_knowledge(context, request, budget).
    import inspect

    signature = inspect.signature(capability.search_knowledge)
    parameters = list(signature.parameters)
    # The protocol call is the first three parameters; the abstention sink
    # is OPTIONAL (story 1.9) and defaults to None.
    assert parameters[:3] == ["context", "request", "budget"]
    assert parameters[3] == "abstention_sink"
    assert signature.parameters["abstention_sink"].default is None


# ---------------------------------------------------------------------
# The abstention sink (story 1.9): the exact reason at each insufficient site
# ---------------------------------------------------------------------


def _sink_outcome(reason: str):
    """A capability configured to end in the recorded insufficiency that
    carries ``reason`` on its log surface."""
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    if reason == "no_documents_retrieved":
        rows = []
        reranking = FakeReranking(outcome=RerankOutcome(selection=()))
    elif reason == "reranker_input_too_long":
        reranking = FakeReranking(error=RerankerInputTooLongError("TEI rejected input"))
    elif reason == "result_budget_exhausted":
        # A selection that yields a hit, then a budget that cuts it away.
        reranking = FakeReranking(
            outcome=RerankOutcome(selection=(ScoredCandidate(text="alpha", score=0.7, position=0),))
        )
    else:
        reranking = FakeReranking(outcome=RerankOutcome(selection=()))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)
    return capability


def test_sink_receives_the_exact_reason_at_each_insufficient_site():
    """The optional per-call kwarg hands the recorded reason to the caller —
    the same string the log surface carries, at all four sites."""
    for reason in (
        "no_documents_retrieved",
        "reranker_input_too_long",
        "reranker_selected_nothing",
        "result_budget_exhausted",
    ):
        capability = _sink_outcome(reason)
        received = []
        budget = (
            OperationBudget(timeout_ms=5000, max_results=10, max_result_bytes=10)
            if reason == "result_budget_exhausted"
            else BUDGET
        )
        result = asyncio.run(
            capability.search_knowledge(context(), prepared(), budget, abstention_sink=received.append)
        )
        assert received == [reason], reason
        assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE


def test_sink_default_none_leaves_the_executor_call_unchanged():
    """The three-argument protocol call still works: the executor passes no
    sink and the capability neither raises nor calls anything."""
    capability = _sink_outcome("no_documents_retrieved")
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE


def test_sink_is_per_call_never_shared_state():
    """Two concurrent runs with different sinks each receive only their own
    reason — the sink travels with the call."""
    capability = _sink_outcome("reranker_selected_nothing")
    first, second = [], []

    async def scenario():
        return await asyncio.gather(
            capability.search_knowledge(context(), prepared(), BUDGET, abstention_sink=first.append),
            capability.search_knowledge(context(), prepared(), BUDGET, abstention_sink=second.append),
        )

    asyncio.run(scenario())
    assert first == ["reranker_selected_nothing"]
    assert second == ["reranker_selected_nothing"]


def test_a_raising_sink_fails_the_turn_loudly():
    """A sink that raises is not swallowed: a silently lost reason is the
    drift the hook exists to prevent."""

    def exploding_sink(reason):
        raise RuntimeError("sink broke")

    capability = _sink_outcome("no_documents_retrieved")
    with pytest.raises(RuntimeError, match="sink broke"):
        asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET, abstention_sink=exploding_sink))
