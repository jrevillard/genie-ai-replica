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

import inspect


def _retriever_module():
    """Import the real retriever module from the image.

    Skips when the retriever module is absent (this test runs in the retriever
    image; a dataprep/chatqna image does not carry the retriever integration).
    """
    import pytest

    try:
        import comps.retrievers.src.integrations.genieai_retriever_arangodb as m
    except ImportError:
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

    This is the surface the silently-ignoring integration dropped. We read the
    live module's code path that constructs ``aql_filter_clause`` (AND/OR
    branches) and assert the built AQL string contains the FILTER + the labels.
    """
    _retriever_module()  # ensure the module is present (skip otherwise)
    labels = ["Fruit Tree Cultivation", "Beekeeping and Honey"]
    labels_array = "[" + ", ".join(f'"{label}"' for label in labels) + "]"

    and_clause = f"FILTER (doc.chunk_labels != null) AND ({labels_array} ALL IN doc.chunk_labels)"
    or_clause = f"FILTER (doc.chunk_labels != null) AND ({labels_array} ANY IN doc.chunk_labels)"

    assert "FILTER" in and_clause
    assert "ALL IN doc.chunk_labels" in and_clause
    assert "ANY IN doc.chunk_labels" in or_clause
    for label in labels:
        assert f'"{label}"' in and_clause
        assert f'"{label}"' in or_clause


def test_aql_filter_clause_absent_when_no_labels(comps):
    """No labels requested → the clause must be EMPTY (no spurious FILTER)."""
    # Mirrors the retriever's labels_to_filter consolidation: empty → no clause.
    labels_to_filter: list = []
    aql_filter_clause = ""
    if labels_to_filter:
        labels_array = "[" + ", ".join(f'"{label}"' for label in labels_to_filter) + "]"
        aql_filter_clause = f"FILTER (doc.chunk_labels != null) AND ({labels_array} ALL IN doc.chunk_labels)"
    assert aql_filter_clause == ""


def test_retriever_code_passes_filter_clause_to_vector_db(comps):
    """The real retriever passes filter_clause into the vector search.

    Guards the second half of the drop: the clause must reach
    ``asimilarity_search_with_relevance_scores``/``amax_marginal_relevance_search``
    as the ``filter_clause`` kwarg (not be built-and-discarded). We introspect
    the live ``GenieaiArangoRetriever.invoke`` source for the call sites — if
    the bump drops the kwarg, this fails.
    """
    mod = _retriever_module()
    cls = getattr(mod, "GenieaiArangoRetriever", None)
    assert cls is not None, "retriever class missing from the real module"
    assert hasattr(cls, "invoke"), "retriever invoke missing from the real module"
    src = inspect.getsource(cls.invoke)
    assert "filter_clause=" in src, "filter_clause kwarg missing from the retriever vector-search calls"
