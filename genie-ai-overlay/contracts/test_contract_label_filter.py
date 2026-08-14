# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Focused label-filter contract test — wrong-category docs must be excluded.

The regression this guards: a retriever whose ArangoDB integration silently
ignores the ``filter_clause`` (the historical langchain-arangodb 0.0.4 bug — a
``FILTER`` never reached the AQL, so a category selection was a no-op and
wrong-category chunks surfaced). The contract asserts BOTH surfaces that make
the filter real:

1. The AQL ``FILTER`` clause is actually constructed when labels are requested
   (against the real retriever module in the image).
2. ``_chunk_passes_label_filter`` excludes wrong-category chunks under
   ``AND``/``OR`` strategies (the defense-in-depth Python net).

A test that only checks "no crash" would pass against the silently-ignoring
integration — this asserts the excluded-document set instead.

Isolation: runs in the retriever image against the real vendored ``comps``. In
the mocked dev env the in-image test skips via the ``comps`` fixture; the pure
``_chunk_passes_label_filter`` tests run anywhere.
"""

from __future__ import annotations

import _harness


def _retriever_module():
    """Import the real retriever module from the image.

    Skips when the retriever module is absent (this test runs in the retriever
    image; a dataprep/chatqna image does not carry the retriever integration).
    A genuine import BREAK inside the image must fail red, not skip — only the
    "module not in this image" case is a legitimate skip.
    """
    import pytest

    try:
        import comps.retrievers.src.integrations.genieai_retriever_arangodb as m
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("retriever module not present in this image")
    return m


# --- pure: Python label-filter net (runs in the dev venv too) -------------


def test_pure_filter_excludes_wrong_category(comps):
    """A chunk with the WRONG category is excluded under AND and OR."""
    mod = _retriever_module()
    fn = mod._chunk_passes_label_filter
    assert fn(["Beekeeping and Honey"], ["Fruit Tree Cultivation"], "AND") is False
    assert fn(["Beekeeping and Honey"], ["Fruit Tree Cultivation"], "OR") is False


def test_pure_filter_includes_matching_category(comps):
    """A chunk with a MATCHING category is kept."""
    mod = _retriever_module()
    fn = mod._chunk_passes_label_filter
    assert fn(["Fruit Tree Cultivation"], ["Fruit Tree Cultivation"], "AND") is True
    assert fn(["Beekeeping and Honey", "Fruit Tree Cultivation"], ["Fruit Tree Cultivation"], "OR") is True


def test_pure_filter_empty_labels_is_noop(comps):
    """No requested labels → no filter → every chunk passes (incl. unlabeled)."""
    mod = _retriever_module()
    fn = mod._chunk_passes_label_filter
    assert fn([], [], "OR") is True
    assert fn(["Anything"], [], "AND") is True


def test_pure_filter_unlabeled_chunk_excluded_when_filter_active(comps):
    """A chunk with NO labels is excluded once a filter is requested."""
    mod = _retriever_module()
    fn = mod._chunk_passes_label_filter
    assert fn([], ["Fruit Tree Cultivation"], "OR") is False


# --- in-image: AQL filter-clause construction (the drop surface) ----------


def test_aql_filter_clause_constructed_for_labels(comps):
    """The retriever builds a real FILTER clause when labels are requested.

    This is the surface the silently-ignoring integration dropped. We call the
    REAL module's ``_build_aql_filter_clause`` (the same helper ``invoke`` uses)
    and assert the produced AQL contains the FILTER + the labels — a regression
    in the clause construction fails here instead of asserting a re-implementation.
    """
    mod = _retriever_module()  # ensure the module is present (skip otherwise)
    labels = ["Fruit Tree Cultivation", "Beekeeping and Honey"]

    and_clause = mod._build_aql_filter_clause(labels, "AND")
    or_clause = mod._build_aql_filter_clause(labels, "OR")

    assert "FILTER" in and_clause
    assert "ALL IN doc.chunk_labels" in and_clause
    assert "ANY IN doc.chunk_labels" in or_clause
    for label in labels:
        assert f'"{label}"' in and_clause
        assert f'"{label}"' in or_clause


def test_aql_filter_clause_absent_when_no_labels(comps):
    """No labels requested → the real builder returns an empty clause."""
    mod = _retriever_module()
    assert mod._build_aql_filter_clause([], "OR") == ""


def test_retriever_forwards_filter_clause_to_vector_search(comps):
    """The retriever forwards the constructed FILTER clause to the vector search.

    Behavioral replacement for the source-grep test: invokes the real
    ``GenieaiArangoRetriever.invoke`` code path with mocked ArangoDB validation
    and ``ArangoVector``, capturing the ``filter_clause`` kwarg that reaches
    the vector search method. If a future change drops the kwarg, this fails —
    proving the filter reaches the database layer, not just the code.
    """
    import asyncio
    import unittest.mock as mock

    mod = _retriever_module()
    labels = ["Fruit Tree Cultivation", "Beekeeping and Honey"]

    # Encode labels in search_start (the data-contract path chatqna uses).
    from core.label_contract import encode_filter_labels

    encoded_search_start = encode_filter_labels("chunk", labels)

    # Create a retriever instance WITHOUT __init__ (bypasses the ArangoDB
    # connection the real __init__ makes — the behavior under test is the
    # filter_clause forwarding inside invoke, not the client setup).
    retriever = object.__new__(mod.GenieaiArangoRetriever)
    retriever._bm25_views_ensured = set()

    # Mock self.db to pass the validation gates invoke() hits before the
    # vector search (has_graph, has_vertex_collection, count, random).
    mock_db = mock.MagicMock()
    mock_db.has_graph.return_value = True
    mock_db.graph.return_value.has_vertex_collection.return_value = True
    mock_db.graph.return_value.has_edge_collection.return_value = True
    mock_db.collection.return_value.count.return_value = 1000
    mock_db.collection.return_value.random.return_value = {
        "_id": "test/key",
        "embedding": [0.1] * 128,
    }
    retriever.db = mock_db

    # Capture the filter_clause kwarg passed to the vector search method.
    captured: dict = {}

    async def _capture_search(*args, **kwargs):
        captured.update(kwargs)
        return []

    # Patch ArangoVector and the embedding class so invoke() reaches the
    # vector search call without real ArangoDB / model endpoints.
    with (
        mock.patch.object(mod, "ArangoVector") as mock_av_cls,
        mock.patch.object(mod, "HuggingFaceBgeEmbeddings") as mock_emb_cls,
    ):
        mock_av = mock.MagicMock()
        mock_av.asimilarity_search_with_relevance_scores = _capture_search
        mock_av.amax_marginal_relevance_search = _capture_search
        mock_av_cls.return_value = mock_av

        mock_emb_cls.return_value = mock.MagicMock()

        input_doc = mod.GenieEmbedDoc(
            text="test query",
            embedding=[0.1] * 128,
            search_start=encoded_search_start,
        )

        asyncio.run(retriever.invoke(input_doc))

    # Assert the filter_clause was forwarded to the vector search.
    assert "filter_clause" in captured, (
        "filter_clause kwarg missing from the vector search call — the category filter is silently dropped"
    )
    clause = captured["filter_clause"]
    assert "FILTER" in clause, "FILTER keyword missing from the forwarded clause"
    for label in labels:
        assert f'"{label}"' in clause, f"label {label!r} missing from FILTER clause"


def test_installed_arangovector_exposes_filter_clause_named_param(comps):
    """The REAL installed langchain-arangodb promotes filter_clause to a named param.

    Guards the story's central claim durably instead of comment-only: >=1.2.0
    exposes ``filter_clause`` as a NAMED parameter on the sync similarity-search
    surface the retriever's calls funnel into — including the
    ``similarity_search_by_vector`` methods langchain-core's
    ``max_marginal_relevance_search`` MMR path delegates to — the 0.0.4 release
    swallowed it via ``**kwargs``, so the category ``FILTER`` never reached the
    AQL. If a future bump reintroduces the swallow (named param gone) or drops
    below the minimum version, this fails in-image.
    """
    import importlib.metadata
    import inspect

    import pytest
    from langchain_arangodb import ArangoVector
    from packaging.version import Version

    installed = Version(importlib.metadata.version("langchain-arangodb"))
    assert installed >= Version("1.2.0"), (
        f"langchain-arangodb must be >=1.2.0 (filter_clause named-param fix-pin); installed: {installed}"
    )

    for method_name in (
        "similarity_search",
        "similarity_search_with_score",
        "similarity_search_by_vector",
        "similarity_search_by_vector_with_score",
    ):
        method = getattr(ArangoVector, method_name, None)
        assert method is not None, f"installed ArangoVector has no {method_name!r}"
        try:
            params = inspect.signature(method).parameters
        except (TypeError, ValueError):
            pytest.fail("non-introspectable method: " + method_name)
        assert "filter_clause" in params, (
            f"installed ArangoVector.{method_name} has no named filter_clause "
            "param — the 0.0.4-style silent-drop bug is back"
        )
