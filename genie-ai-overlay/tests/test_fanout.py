"""Tests for the additive multi-graph fan-out (Story 1.0/1.1/1.4/1.5).

The orchestrator (invoke_fanout) lives on the GenieaiArangoRetriever class,
but the pure helpers (_fanout_should_engage, _attach_provenance,
_merge_per_graph_results) are testable in isolation. This is the layer-1
unit coverage; the live-deploy LG-5 boundary probe is Wave R5.

The decision matrix is in `_bmad-output/implementation-artifacts/1-0-retriever-provenance-materialization.md`
(Decisions A–F); these tests pin the contract the orchestrator commits to.
"""

from retriever.genieai_retriever_arangodb import (
    _attach_provenance,
    _fanout_should_engage,
    _merge_per_graph_results,
)

# ─── Decision D: fanout_should_engage ────────────────────────────────────────
# David, 2026-09-21: the retriever must work smoothly in BOTH shapes —
#   A: legacy single graph only → empty carrier → fan-out does NOT engage.
#   B: legacy graph + one or more OKF graphs → ≥1 element carrier → fan-out
#      engages with the FULL set (the legacy graph as the first leg + N OKF
#      graph names). The chat-side carrier is the single source of truth.


class TestFanoutShouldEngage:
    """The engage/bypass rules for the two shape contract:
    A) empty carrier → legacy single-graph (no fan-out);
    B) ≥1 graph → fan-out engages with the FULL set.
    """

    def test_empty_carrier_bypasses_case_A(self):
        assert _fanout_should_engage([]) is False

    def test_none_carrier_bypasses_case_A(self):
        assert _fanout_should_engage(None) is False

    def test_single_graph_engages_case_B(self):
        """Case B: even a single-element carrier engages fan-out (David,
        2026-09-21). The legacy graph is the first leg; one OKF graph
        could be added later without changing the contract."""
        assert _fanout_should_engage(["GRAPH"]) is True

    def test_legacy_plus_one_okf_graph_engages_case_B(self):
        assert _fanout_should_engage(["GRAPH", "OKF_kenya-gov_v3"]) is True

    def test_many_graphs_engage_case_B(self):
        assert _fanout_should_engage([f"OKF_{slug}_v1" for slug in ("kenya", "health", "water")]) is True

    def test_feature_off_bypasses_regardless_of_count(self):
        assert _fanout_should_engage(["GRAPH", "OKF_kenya-gov_v3"], fanout_enabled=False) is False

    def test_feature_on_explicit(self):
        assert _fanout_should_engage(["GRAPH", "OKF_kenya-gov_v3"], fanout_enabled=True) is True


# ─── Story 1.0: attach_provenance (fusion-time attribution) ───────────────────


class _StubDoc:
    """Stand-in for langchain_core.documents.Document; the helper only reads
    metadata + id via attribute access."""

    def __init__(self, doc_id, metadata):
        self.id = doc_id
        self.metadata = metadata


class TestAttachProvenance:
    def test_graph_name_added_to_metadata(self):
        doc = _StubDoc("c1", {"chunk_labels": ["Foo"]})
        result = _attach_provenance([{"doc": doc, "score": 0.9}], "GRAPH")
        assert result[0]["doc"].metadata["graph_name"] == "GRAPH"

    def test_repo_id_added_when_provided(self):
        doc = _StubDoc("c1", {})
        _attach_provenance([{"doc": doc, "score": 0.5}], "GRAPH", repo_id="r-kenya")
        assert doc.metadata["repo_id"] == "r-kenya"

    def test_repo_id_omitted_when_not_provided(self):
        doc = _StubDoc("c1", {})
        _attach_provenance([{"doc": doc, "score": 0.5}], "GRAPH")
        assert "repo_id" not in doc.metadata

    def test_concept_id_from_file_id(self):
        """The content-only-chunking invariant (amendment C): chunk.file_id is
        the concept_id; the helper preserves it verbatim."""
        doc = _StubDoc("c1", {"file_id": "conceptA"})
        _attach_provenance([{"doc": doc, "score": 0.5}], "GRAPH")
        assert doc.metadata["concept_id"] == "conceptA"

    def test_concept_id_not_overwritten_if_already_present(self):
        doc = _StubDoc("c1", {"file_id": "conceptA", "concept_id": "conceptB"})
        _attach_provenance([{"doc": doc, "score": 0.5}], "GRAPH")
        assert doc.metadata["concept_id"] == "conceptB"

    def test_empty_items_returns_empty(self):
        assert _attach_provenance([], "GRAPH") == []
        assert _attach_provenance(None, "GRAPH") == []


# ─── Story 1.5: merge_per_graph_results (cross-graph 2-level RRF Level-2) ─────


class TestMergePerGraphResults:
    def test_empty_input(self):
        assert _merge_per_graph_results([], k=10) == []

    def test_single_graph_preserves_rank(self):
        per_graph = [
            (
                "GRAPH",
                [
                    {"doc": _StubDoc("c1", {}), "score": 0.0},
                    {"doc": _StubDoc("c2", {}), "score": 0.0},
                ],
            )
        ]
        result = _merge_per_graph_results(per_graph, k=10)
        assert [r["doc"].id for r in result] == ["c1", "c2"]

    def test_cross_graph_rrf_weights_per_graph(self):
        """Two graphs each with one doc — the RRF formula is
        1 / (k + rank) summed across legs. With k=60 and both docs at rank 1,
        each gets the same fused score; order between them is then stable."""
        per_graph = [
            ("GRAPH", [{"doc": _StubDoc("c1", {}), "score": 0.0}]),
            ("OKF_kenya-gov_v3", [{"doc": _StubDoc("c2", {}), "score": 0.0}]),
        ]
        result = _merge_per_graph_results(per_graph, k=60)
        assert len(result) == 2
        # Each contributes 1/(60+1) = 1/61 from a single rank-1 hit.
        assert all(abs(r["score"] - 1 / 61) < 1e-9 for r in result)

    def test_same_chunk_in_two_graphs_deduplicated_via_compound_key(self):
        """A cloned chunk in two graphs (graph_name, chunk_id) is the canonical
        citation handle — we do NOT collapse them into one entry."""
        per_graph = [
            ("GRAPH", [{"doc": _StubDoc("c1", {"graph_name": "GRAPH"}), "score": 0.0}]),
            ("OKF_clone_v1", [{"doc": _StubDoc("c1", {"graph_name": "OKF_clone_v1"}), "score": 0.0}]),
        ]
        result = _merge_per_graph_results(per_graph, k=10)
        assert len(result) == 2  # NOT deduped — the graph_name distinguishes them

    def test_empty_per_graph_list_skipped(self):
        per_graph = [
            ("GRAPH", []),
            ("OKF_kenya-gov_v3", [{"doc": _StubDoc("c1", {}), "score": 0.0}]),
        ]
        result = _merge_per_graph_results(per_graph, k=10)
        assert len(result) == 1
        assert result[0]["doc"].id == "c1"

    def test_top_k_truncation(self):
        per_graph = [
            ("GRAPH", [{"doc": _StubDoc(f"c{i}", {}), "score": 0.0} for i in range(10)]),
        ]
        result = _merge_per_graph_results(per_graph, k=3)
        assert len(result) == 3

    def test_top_k_zero_returns_empty(self):
        per_graph = [("GRAPH", [{"doc": _StubDoc("c1", {}), "score": 0.0}])]
        assert _merge_per_graph_results(per_graph, k=0) == []

    def test_unkeyable_doc_gets_synthetic_id_and_is_kept(self):
        per_graph = [
            (
                "GRAPH",
                [
                    {"doc": _StubDoc(None, {}), "score": 0.0},
                    {"doc": _StubDoc("c1", {}), "score": 0.0},
                ],
            )
        ]
        result = _merge_per_graph_results(per_graph, k=10)
        assert len(result) == 2  # both kept (never drop, never mis-merge)
