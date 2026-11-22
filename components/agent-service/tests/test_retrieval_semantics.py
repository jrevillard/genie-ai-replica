# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ArangoDB retrieval-stage behaviors, asserted against V02 §4.1–4.8.

The recorded AQL shapes are asserted verbatim (the fixture's ``aql`` fields),
the RRF fusion semantics, the label clause + post-filter (including the
recorded dense-metadata quirk), the batched enrichment and the tolerated
CAP-1 absence.
"""

import asyncio
import json
from pathlib import Path

import pytest

from capabilities.adapters.arango_retrieval import (
    ArangoRetrievalAdapter,
    build_aql_filter_clause,
    chunk_passes_label_filter,
    normalize_chunk_id,
    rrf_fuse,
)
from capabilities.adapters.env_config import ArangoConfig, HybridConfig

FIXTURES = Path(__file__).resolve().parents[3] / "docs" / "baselines" / "v02-opea-query-path-contract.fixtures.json"


def fixtures():
    return json.loads(FIXTURES.read_text())


def recorded_knobs():
    """The deployed retriever knobs the fixtures record (V02 §3.1)."""
    return fixtures()["measured"]["deployed_env"]["retriever"]


def make_adapter(rows_per_query=None, views=(), config_env=None):
    """An adapter over a fake python-arango database handle.

    ``rows_per_query`` maps a marker (a distinctive substring of the AQL) to
    the rows that query returns. Every executed query is captured.
    """
    executed: list[tuple[str, dict]] = []
    row_map = rows_per_query or {}

    class FakeCursor:
        def __init__(self, rows):
            self._rows = rows

        def __iter__(self):
            return iter(self._rows)

    class FakeAql:
        def execute(self, query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
            executed.append((query, bind_vars))
            for marker, rows in row_map.items():
                if marker in query:
                    return FakeCursor(rows)
            return FakeCursor([])

    class FakeDb:
        aql = FakeAql()

        def views(self):
            return [{"name": v} for v in views]

        def create_arangosearch_view(self, name, properties):
            created.append((name, properties))

    created: list = []
    db = FakeDb()
    env = config_env if config_env is not None else {}
    arango_config = ArangoConfig.load({**recorded_knobs_env(), **env})
    hybrid = HybridConfig.load({**recorded_knobs_env(), **env})
    adapter = ArangoRetrievalAdapter(db, arango_config, hybrid)
    adapter.executed = executed
    adapter.created = created
    return adapter


def recorded_knobs_env():
    """The deployed knob values, as the venue's env carries them."""
    env = {}
    for key, value in recorded_knobs().items():
        if key.startswith("RETRIEVER_") or key.startswith("ARANGO_"):
            env[key] = value
    # The measured env block carries the URL; keep it for the config load.
    return env


def run(coroutine):
    return asyncio.run(coroutine)


# ---------------------------------------------------------------------
# Dense leg (V02 §4.1)
# ---------------------------------------------------------------------


def test_dense_search_runs_the_recorded_bruteforce_cosine_aql():
    adapter = make_adapter({"COSINE_SIMILARITY": [{"key": "c1", "text": "a", "score": 0.9}]})
    run(adapter.dense_search([0.1] * 4, [], "OR"))
    aql, bind_vars = adapter.executed[0]
    assert "@@collection" in aql
    assert "COSINE_SIMILARITY(doc.embedding, @embedding)" in aql
    assert "SORT score DESC" in aql
    assert "LIMIT @k" in aql
    assert bind_vars["k"] == 20  # the deployed RETRIEVER_ARANGO_K
    assert bind_vars["@collection"] == "GRAPH_SOURCE"  # search_start=chunk, graph GRAPH


def test_dense_threshold_applies_after_the_top_k_cut_not_inside_the_aql():
    """The recorded wrapper filters the top-k AFTER the cut: the AQL must NOT
    carry a threshold, and rows below it are dropped in Python."""
    rows = [
        {"key": "c1", "text": "a", "score": 0.5},
        {"key": "c2", "text": "b", "score": 0.3},
        {"key": "c3", "text": "c", "score": 0.1},  # below the 0.2 threshold
    ]
    adapter = make_adapter({"COSINE_SIMILARITY": rows})
    results = run(adapter.dense_search([0.1] * 4, [], "OR"))
    aql, _bind = adapter.executed[0]
    assert "score_threshold" not in aql and "FILTER score >=" not in aql
    assert [r["doc"].key for r in results] == ["c1", "c2"]


def test_dense_rows_carry_no_chunk_labels_so_a_label_filter_drops_them_all():
    """The recorded quirk: dense results have empty metadata, so the
    defense-in-depth filter drops EVERY dense result when labels are active."""
    rows = [{"key": "c1", "text": "a", "score": 0.9}]
    adapter = make_adapter({"COSINE_SIMILARITY": rows})
    results = run(adapter.dense_search([0.1] * 4, ["L1"], "OR"))
    assert results == []


def test_dense_leg_failure_returns_empty_and_never_raises():
    class FakeAql:
        @staticmethod
        def execute(query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
            raise RuntimeError("db down")

    class FakeDb:
        aql = FakeAql()

    config = ArangoConfig.load(recorded_knobs_env())
    adapter = ArangoRetrievalAdapter(FakeDb(), config, HybridConfig.load(recorded_knobs_env()))
    assert run(adapter.dense_search([0.1], [], "OR")) == []


def test_dense_row_with_null_score_is_skipped_not_raised():
    """A partially indexed collection carries chunks without an embedding:
    COSINE_SIMILARITY returns null for them, and a null score reaching the
    float() coercion raises OUTSIDE the execute try — the whole run fails
    where the dense leg must degrade to the remaining scored rows."""
    rows = [
        {"key": "c1", "text": "a", "score": None},
        {"key": "c2", "text": "b", "score": 0.9},
    ]
    adapter = make_adapter({"COSINE_SIMILARITY": rows})
    results = run(adapter.dense_search([0.1] * 4, [], "OR"))
    assert [r["doc"].key for r in results] == ["c2"]
    assert [r["doc"].score for r in results] == [0.9]


# ---------------------------------------------------------------------
# BM25 leg (V02 §4.2)
# ---------------------------------------------------------------------


def test_bm25_search_runs_the_recorded_view_aql_on_the_raw_query():
    rows = [{"key": "c9", "text": "x", "chunk_labels": ["L1"], "score": 5.0}]
    adapter = make_adapter({"BM25_VIEW": rows})
    results = run(adapter.bm25_search("raw query", "GRAPH", ["L1"], "OR"))  # noqa: F841 — rows are not the subject
    aql, bind_vars = adapter.executed[0]
    assert "FOR doc IN `GRAPH_BM25_VIEW`" in aql
    assert "SEARCH ANALYZER(doc.text IN TOKENS(@query, @analyzer), @analyzer)" in aql
    assert "BM25(doc)" in aql
    assert "SORT _bm25_score DESC" in aql
    assert bind_vars["query"] == "raw query"  # the RAW text, never the prefixed one
    assert bind_vars["analyzer"] == "text_en"
    assert bind_vars["n"] == 50  # max(k=20, BM25_CANDIDATES=50)


def test_bm25_label_postfilter_drops_rows_that_fail_the_strategy():
    rows = [
        {"key": "c1", "text": "x", "chunk_labels": ["L1"], "score": 5.0},
        {"key": "c2", "text": "y", "chunk_labels": ["L2"], "score": 4.0},  # fails AND
        {"key": "c3", "text": "z", "chunk_labels": None, "score": 3.0},  # no labels
    ]
    adapter = make_adapter({"BM25_VIEW": rows})
    results = run(adapter.bm25_search("q", "GRAPH", ["L1"], "AND"))
    assert [r["doc"].key for r in results] == ["c1"]


def test_bm25_leg_failure_returns_empty_and_flags_the_degradation():
    class FakeAql:
        @staticmethod
        def execute(query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
            if "BM25_VIEW" in query:
                raise RuntimeError("view broken")

            class C:
                def __iter__(self):
                    return iter([])

            return C()

    class FakeDb:
        aql = FakeAql()

    config = ArangoConfig.load(recorded_knobs_env())
    adapter = ArangoRetrievalAdapter(FakeDb(), config, HybridConfig.load(recorded_knobs_env()))
    assert run(adapter.bm25_search("q", "GRAPH", [], "OR")) == []
    assert adapter.bm25_degraded is True


def test_bm25_view_is_created_lazily_with_the_recorded_properties_and_cached_on_success():
    adapter = make_adapter(views=[])
    run(adapter.bm25_search("q", "GRAPH", [], "OR"))
    name, properties = adapter.created[0]
    assert name == "GRAPH_BM25_VIEW"
    links = properties["links"]["GRAPH_SOURCE"]
    assert links["analyzers"] == ["text_en"]
    assert set(links["fields"]) == {"text", "chunk_labels"}
    assert links["includeAllFields"] is False
    # Cached: the second call creates nothing new.
    run(adapter.bm25_search("q", "GRAPH", [], "OR"))
    assert len(adapter.created) == 1


def test_bm25_view_creation_failure_is_logged_and_never_cached():
    class FakeDb:
        def views(self):
            return []

        def create_arangosearch_view(self, name, properties):
            raise RuntimeError("no permission")

        class aql:
            @staticmethod
            def execute(query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
                class C:
                    def __iter__(self):
                        return iter([])

                return C()

    config = ArangoConfig.load(recorded_knobs_env())
    adapter = ArangoRetrievalAdapter(FakeDb(), config, HybridConfig.load(recorded_knobs_env()))
    run(adapter.bm25_search("q", "GRAPH", [], "OR"))
    run(adapter.bm25_search("q", "GRAPH", [], "OR"))
    # Retried on the next request: the cache keeps failures out.
    assert adapter._bm25_views_ensured == set()


# ---------------------------------------------------------------------
# Fusion (V02 §4.3)
# ---------------------------------------------------------------------


def _ns(key):
    from types import SimpleNamespace

    return SimpleNamespace(key=key)


def test_rrf_fuse_weights_by_rank_over_newly_seen_ids():
    dense = [{"doc": _ns("a"), "score": 0.9}, {"doc": _ns("b"), "score": 0.8}]
    bm25 = [{"doc": _ns("b"), "score": 5.0}, {"doc": _ns("c"), "score": 4.0}]
    fused = rrf_fuse(dense, bm25, k=60, dense_weight=1.0, lexical_weight=1.0)
    scores = {entry["doc"].key: entry["score"] for entry in fused}
    # a: dense rank 1 → 1/61. b: dense rank 2 (1/62) + bm25 rank 1 (1/61). c: bm25 rank 2 (1/62).
    assert scores["a"] == pytest.approx(1 / 61)
    assert scores["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert scores["c"] == pytest.approx(1 / 62)
    # b tops the fused order; ties keep insertion order (dense first).
    assert [entry["doc"].key for entry in fused] == ["b", "a", "c"]


def test_rrf_fuse_strips_collection_prefix_and_keeps_unkeyed_standalone():
    dense = [{"doc": _ns("GRAPH/x"), "score": 0.9}]
    bm25 = [{"doc": _ns("x"), "score": 5.0}, {"doc": _ns(None), "score": 1.0}]
    fused = rrf_fuse(dense, bm25)
    assert len(fused) == 2
    # GRAPH/x and x are ONE identity: the fused entry carries BOTH rank
    # contributions (dense rank 1 + bm25 rank 1), whichever doc object it kept.
    fused_entry = next(entry for entry in fused if entry["doc"].key in ("x", "GRAPH/x"))
    assert fused_entry["score"] == pytest.approx(1 / 61 + 1 / 61)
    # The unkeyed doc is kept standalone (its own entry).
    standalone = [entry for entry in fused if entry["doc"].key is None]
    assert len(standalone) == 1


def test_rrf_ties_keep_insertion_order_favouring_the_dense_channel():
    dense = [{"doc": _ns("a"), "score": 0.5}]
    bm25 = [{"doc": _ns("b"), "score": 5.0}]
    fused = rrf_fuse(dense, bm25, k=60)
    # Same rank-1 contribution both sides → tie → dense (inserted first) wins.
    assert fused[0]["doc"].key == "a"


def test_fusion_failure_falls_back_to_dense_only(monkeypatch):
    rows = [{"key": "c1", "text": "a", "score": 0.9}]
    adapter = make_adapter({"COSINE_SIMILARITY": rows})
    run(adapter.bm25_search("q", "GRAPH", [], "OR"))  # ensure the view exists

    import capabilities.adapters.arango_retrieval as module

    def broken_fuse(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "rrf_fuse", broken_fuse)
    results = run(adapter.fused_candidates([0.1], "q", []))
    assert [r["doc"].key for r in results] == ["c1"]


def test_fusion_rescues_a_dense_empty_result():
    bm25_rows = [{"key": "c9", "text": "x", "chunk_labels": None, "score": 5.0}]
    adapter = make_adapter({"BM25_VIEW": bm25_rows})  # the dense query returns nothing
    results = run(adapter.fused_candidates([0.1], "q", []))
    assert [r["doc"].key for r in results] == ["c9"]


def test_hybrid_disabled_is_a_true_noop():
    env = dict(recorded_knobs_env())
    env["RETRIEVER_HYBRID_RETRIEVAL_ENABLED"] = "false"
    rows = [{"key": "c1", "text": "a", "score": 0.9}]
    adapter = make_adapter({"COSINE_SIMILARITY": rows}, config_env=env)
    run(adapter.fused_candidates([0.1], "q", []))
    assert all("BM25_VIEW" not in aql for aql, _ in adapter.executed)


def test_fused_list_is_truncated_to_k():
    bm25_rows = [{"key": f"c{i}", "text": "x", "chunk_labels": None, "score": 5.0 - i} for i in range(30)]
    adapter = make_adapter({"BM25_VIEW": bm25_rows})
    results = run(adapter.fused_candidates([0.1], "q", []))
    assert len(results) == 20  # RETRIEVER_ARANGO_K


# ---------------------------------------------------------------------
# Label clause + post-filter (V02 §4.4, §4.5)
# ---------------------------------------------------------------------


def test_label_clause_matches_the_recorded_aql_for_both_strategies():
    assert (
        build_aql_filter_clause(["L1", "L2"], "OR")
        == 'FILTER (doc.chunk_labels != null) AND (["L1", "L2"] ANY IN doc.chunk_labels)'
    )
    assert (
        build_aql_filter_clause(["L1", "L2"], "AND")
        == 'FILTER (doc.chunk_labels != null) AND (["L1", "L2"] ALL IN doc.chunk_labels)'
    )


def test_no_labels_emits_no_clause_at_all():
    assert build_aql_filter_clause([], "OR") == ""
    assert build_aql_filter_clause(None, "OR") == ""


def test_labels_are_escaped_against_aql_injection():
    clause = build_aql_filter_clause(['say "hi"\\', "tab\tlabel"], "OR")
    assert '"say \\"hi\\"\\\\' in clause
    assert "tab\\tlabel" in clause


def test_invalid_strategy_is_a_value_error():
    with pytest.raises(ValueError, match="Invalid filter_strategy"):
        build_aql_filter_clause(["L1"], "XOR")


def test_post_filter_semantics():
    # No filter → everything passes; empty labels on a chunk → dropped when active.
    assert chunk_passes_label_filter(["L1"], [], "OR") is True
    assert chunk_passes_label_filter(None, ["L1"], "OR") is False
    assert chunk_passes_label_filter([], ["L1"], "OR") is False
    assert chunk_passes_label_filter(["L1", "L2"], ["L1", "L3"], "AND") is False
    assert chunk_passes_label_filter(["L1", "L2"], ["L1", "L3"], "OR") is True


# ---------------------------------------------------------------------
# Enrichment: file_id + CAP-1 (V02 §4.6, §4.7)
# ---------------------------------------------------------------------


def _chunk(key, text="t"):
    from capabilities.adapters.arango_retrieval import RetrievedChunk

    return RetrievedChunk(key=key, text=text, score=0.9)


def _enrichment_adapter():
    rows_file_id = [
        {"key": "c1", "file_id": "f1"},
        {"key": "c2", "file_id": None},
    ]
    rows_identity = [{"key": "c1", "repo_id": "repo-1", "bundle_version": 3}]
    adapter = make_adapter({"file_id: doc.file_id": rows_file_id, "okf_concepts_meta": rows_identity})
    return adapter


def test_file_id_enrichment_is_one_batched_aql_and_yields_lists():
    adapter = _enrichment_adapter()
    results = [{"doc": _chunk("c1", "a"), "score": 0.9}]
    run(adapter.enrich(results))
    enrichment_queries = [
        aql for aql, _ in adapter.executed if "doc._key IN @chunk_ids" in aql and "okf_concepts_meta" not in aql
    ]
    assert len(enrichment_queries) == 1  # ONE batched AQL for all chunks
    assert results[0]["doc"].file_ids == ["f1"]


def test_absent_file_id_yields_empty_list_never_null():
    adapter = _enrichment_adapter()
    results = [{"doc": _chunk("c2", "b"), "score": 0.8}]
    run(adapter.enrich(results))
    assert results[0]["doc"].file_ids == []


def test_cap1_join_resolves_repo_and_bundle_version():
    adapter = _enrichment_adapter()
    results = [{"doc": _chunk("c1", "a"), "score": 0.9}]
    run(adapter.enrich(results))
    assert results[0]["doc"].repo_id == "repo-1"
    assert results[0]["doc"].bundle_version == 3


def test_cap1_identity_absent_leaves_the_chunk_unattributed_without_warning():
    adapter = _enrichment_adapter()
    results = [{"doc": _chunk("c2", "b"), "score": 0.8}]
    run(adapter.enrich(results))
    assert results[0]["doc"].repo_id is None
    assert results[0]["doc"].bundle_version is None


def test_cap1_join_failure_skips_enrichment_and_flags_degradation():
    rows_file_id = [{"key": "c1", "file_id": "f1"}]
    adapter = make_adapter(
        {
            "file_id: doc.file_id": rows_file_id,
            "okf_concepts_meta": RuntimeErrorTriggered(),
        }
    )
    results = [{"doc": _chunk("c1", "a"), "score": 0.9}]
    run(adapter.enrich(results))
    assert results[0]["doc"].repo_id is None
    assert adapter.cap1_degraded is True


class RuntimeErrorTriggered:
    """A row-map entry that raises when its query runs."""

    def __iter__(self):
        raise RuntimeError("collection missing")


def test_cap1_join_is_the_recorded_graph_scoped_concept_join():
    adapter = _enrichment_adapter()
    results = [{"doc": type("D", (), {"key": "c1", "text": "a"})(), "score": 0.9}]
    run(adapter.enrich(results))
    identity_aql = next(aql for aql, _ in adapter.executed if "okf_concepts_meta" in aql)
    assert "FILTER m.graph_name == @graph_name" in identity_aql
    assert "m.concept_id == doc.file_id" in identity_aql
    assert "LET meta = FIRST(" in identity_aql
    _, bind_vars = next((a, b) for a, b in adapter.executed if "okf_concepts_meta" in a)
    assert bind_vars["graph_name"] == "GRAPH"


# ---------------------------------------------------------------------
# Config / identity guards
# ---------------------------------------------------------------------


def test_normalize_chunk_id_strips_collection_prefix():
    assert normalize_chunk_id("GRAPH/x") == "x"
    assert normalize_chunk_id("x") == "x"
    assert normalize_chunk_id(None) is None


def test_boot_validation_rejects_out_of_record_values():
    for key, bad, good in (
        ("RETRIEVER_ARANGO_FILTER_STRATEGY", "XOR", "OR"),
        ("RETRIEVER_ARANGO_SEARCH_MODE", "hybrid", "vector"),
        ("RETRIEVER_ARANGO_SEARCH_START", "node", "chunk"),
        ("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "EUCLIDEAN", "COSINE"),
    ):
        env = dict(recorded_knobs_env())
        env[key] = bad
        with pytest.raises(ValueError):
            ArangoConfig.load(env)
        env[key] = good
        ArangoConfig.load(env)


def test_invalid_filter_strategy_boot_error_matches_the_recorded_pattern():
    """V02 §4.4: an invalid env strategy is a boot ValueError (crash-loop),
    never a request-time HTTP error."""
    env = dict(recorded_knobs_env())
    env["RETRIEVER_ARANGO_FILTER_STRATEGY"] = "not-a-strategy"
    with pytest.raises(ValueError, match="RETRIEVER_ARANGO_FILTER_STRATEGY"):
        ArangoConfig.load(env)


def test_recorded_inert_knobs_are_accepted_without_effect():
    env = dict(recorded_knobs_env())
    env["RETRIEVER_ARANGO_DISTANCE_THRESHOLD"] = "1"  # read by nobody
    env["RETRIEVER_ARANGO_FETCH_K"] = "30"  # mmr-only
    config = ArangoConfig.load(env)
    assert config.k == 20 and config.score_threshold == 0.2


def test_graph_name_charset_guard():
    from capabilities.adapters.arango_retrieval import validate_graph_name

    assert validate_graph_name("GRAPH") == "GRAPH"
    assert validate_graph_name("OKF_slug_v1") == "OKF_slug_v1"
    with pytest.raises(ValueError):
        validate_graph_name("GRAPH}` RETURN malice //")
    with pytest.raises(ValueError):
        validate_graph_name("")


def test_the_modules_aql_doubles_track_the_real_driver_signature():
    """Every ``execute`` double in this module carrying ``bind_vars`` must
    take it in the real driver's position — a double that takes it second
    would mask a positional bind-dict regression (see conftest helper)."""
    from conftest import assert_module_aql_fakes_faithful

    assert_module_aql_fakes_faithful(Path(__file__))
