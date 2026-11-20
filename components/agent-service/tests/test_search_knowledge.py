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

from capabilities.adapters.env_config import ArangoConfig, HybridConfig
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


def slice_outcome(indices, texts_scores):
    return RerankOutcome(
        selection=tuple(ScoredCandidate(text=t, score=s, position=p) for p, (t, s) in enumerate(texts_scores))
    )


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
    rows = [
        {"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"},
        {"key": "c2", "text": "beta", "score": 0.5, "file_id": "f2"},
    ]
    selection = (
        ScoredCandidate(text="alpha", score=0.7, position=0),
        ScoredCandidate(text="beta", score=0.6, position=1),
    )
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, db_factory = make_capability(reranking=reranking, rows=rows)
    result = asyncio.run(capability.search_knowledge(context(graphs=("GRAPH", "OKF_gov_v1")), prepared(), BUDGET))
    assert db_factory.graphs == ["GRAPH", "OKF_gov_v1"]  # context order
    assert len(result.hits) == 2  # one reranking stage over the merged candidates
    # Graph-major merge: GRAPH's candidates first (context order), then the
    # next graph's.
    assert reranking.calls[0][1] == ["alpha", "beta", "alpha", "beta"]


# ---------------------------------------------------------------------
# Degradation mapping
# ---------------------------------------------------------------------


def _capability_with_degraded_adapter(reranking, monkeypatch):
    """A capability whose retrieval adapter reports the CAP-1 degradation."""
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    selection = (ScoredCandidate(text="alpha", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)

    original_init = __import__(
        "capabilities.adapters.arango_retrieval", fromlist=["ArangoRetrievalAdapter"]
    ).ArangoRetrievalAdapter.__init__

    def init_with_degradation(self, db, arango_config, hybrid_config):
        original_init(self, db, arango_config, hybrid_config)
        self.cap1_degraded = True

    monkeypatch.setattr("capabilities.adapters.arango_retrieval.ArangoRetrievalAdapter.__init__", init_with_degradation)
    return capability


def test_cap1_degradation_with_hits_is_degraded_availability(monkeypatch):
    capability = _capability_with_degraded_adapter(None, monkeypatch)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.DEGRADED_AVAILABILITY
    assert len(result.hits) == 1


def test_bm25_failure_with_hits_is_degraded_availability(monkeypatch):
    rows = [{"key": "c1", "text": "alpha", "score": 0.9, "file_id": "f1"}]
    selection = (ScoredCandidate(text="alpha", score=0.7, position=0),)
    reranking = FakeReranking(outcome=RerankOutcome(selection=selection))
    capability, _e, _r, _f = make_capability(reranking=reranking, rows=rows)

    original_init = __import__(
        "capabilities.adapters.arango_retrieval", fromlist=["ArangoRetrievalAdapter"]
    ).ArangoRetrievalAdapter.__init__

    def init_with_degradation(self, db, arango_config, hybrid_config):
        original_init(self, db, arango_config, hybrid_config)
        self.bm25_degraded = True

    monkeypatch.setattr("capabilities.adapters.arango_retrieval.ArangoRetrievalAdapter.__init__", init_with_degradation)
    result = asyncio.run(capability.search_knowledge(context(), prepared(), BUDGET))
    assert result.outcome == OutcomeCode.DEGRADED_AVAILABILITY


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
    assert list(signature.parameters) == ["context", "request", "budget"]
