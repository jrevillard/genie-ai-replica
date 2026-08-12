# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""RRF fusion contract test — dense+BM25 fusion must survive the retriever re-graft.

The regression this guards: the hybrid BM25+RRF fusion machinery (``rrf_fuse``
and its call site inside ``invoke``) lives in the OVERLAY re-graft
(``genieai_retriever_arangodb.py``), NOT in langchain-arangodb — the v1.3→v1.5
re-graft must keep the fused-output behavior intact. A regression in the fusion
(dedup by normalized ``_key``, weighted rank contribution, unkeyed-doc isolation)
or a silent flip of the ``HYBRID_RETRIEVAL_ENABLED`` default changes retrieval
quality with no import error, so the behavior is asserted here, in the image,
against the real module.

The pure ``rrf_fuse`` tests mirror the mocked ``TestRrfFuse`` class in
``tests/test_retriever.py`` (referenced by class name — line numbers drift), so
the fused-output behavior is covered in the in-image suite, not only the mocked
one. The source-introspection test pins the hybrid call site + default.

Isolation: runs in the retriever image against the real vendored ``comps``. In
the mocked dev env the tests skip via the ``comps`` fixture and the module guard
(``_retriever_module``), matching ``test_contract_label_filter.py``.
"""

from __future__ import annotations

import inspect

import _harness
import pytest


def _retriever_module():
    """Import the real retriever module from the image.

    Skips when the retriever module is absent (this test runs in the retriever
    image; a dataprep/chatqna image does not carry the retriever integration).
    A genuine import BREAK inside the image must fail red, not skip — only the
    "module not in this image" case is a legitimate skip.
    """
    try:
        import comps.retrievers.src.integrations.genieai_retriever_arangodb as m
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("retriever module not present in this image")
    return m


class _FakeDoc:
    """Lightweight stand-in exposing the ``.id`` attribute ``rrf_fuse`` reads.

    ``rrf_fuse``/``_normalize_chunk_id`` only touch ``doc.id``, so a plain
    object is sufficient — no real ``Document`` construction needed.
    """

    def __init__(self, id=None):
        self.id = id


def _mk_result(key, score=0.0):
    """Build a {"doc", "score"} result element for fusion tests."""
    return {"doc": _FakeDoc(id=key), "score": score}


# --- pure: rrf_fuse fusion behavior (mirrors TestRrfFuse) -------------------


def test_doc_in_both_channels_gets_both_contributions(comps):
    """A doc present in BOTH channels receives both rank contributions."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a")],
        [_mk_result("a")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    a_score = next(r["score"] for r in fused if r["doc"].id == "a")
    assert a_score == pytest.approx(1 / 61 + 1 / 61)


def test_fused_doc_keeps_input_identity(comps):
    """The fused entry for a doc present in both channels keeps the SAME doc object.

    The rerank handoff depends on the chunk's metadata surviving retrieval (e.g.
    ``chunk_embedding`` carried on the doc), so fusion must not replace the doc
    with a copy or another channel's instance — object identity must survive.
    """
    mod = _retriever_module()
    doc = _FakeDoc(id="a")
    doc.meta = {"chunk_embedding": [1, 2, 3]}
    fused = mod.rrf_fuse(
        [{"doc": doc, "score": 0.1}],
        [_mk_result("a")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert fused[0]["doc"] is doc
    assert fused[0]["doc"].meta == {"chunk_embedding": [1, 2, 3]}


def test_doc_in_one_channel_gets_single_contribution(comps):
    """A doc in only the dense channel gets that single contribution."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a")],
        [],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert fused[0]["score"] == pytest.approx(1 / 61)


def test_doc_in_both_ranks_above_doc_in_one(comps):
    """Dual-channel weighted fusion ordering — rank-1 in both beats rank-1 in one.

    Explicit ``dense_weight=1.0, lexical_weight=1.0`` are passed so the ordering
    assertion does not depend on env-default weights a deployment may change.
    """
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a"), _mk_result("b")],
        [_mk_result("a")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    scores = {r["doc"].id: r["score"] for r in fused}
    assert scores["a"] > scores["b"]
    # Exact non-trivial rank contribution: "b" is dense rank-2 only → 1/(k+2),
    # pinning the rank denominator so a k+rank regression fails.
    assert scores["b"] == pytest.approx(1 / 62)


def test_lexical_only_doc_surfaces(comps):
    """A doc found only by BM25 (lexical) still surfaces in the fused set."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a")],
        [_mk_result("b")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert {r["doc"].id for r in fused} == {"a", "b"}


def test_returns_sorted_descending(comps):
    """The fused list is sorted by fused score descending."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a"), _mk_result("b")],
        [_mk_result("a"), _mk_result("b")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    scores = [r["score"] for r in fused]
    assert scores == sorted(scores, reverse=True)


def test_weight_asymmetry(comps):
    """Asymmetric channel weights scale each contribution by its weight."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a")],
        [_mk_result("a")],
        k=60,
        dense_weight=2.0,
        lexical_weight=0.5,
    )
    assert fused[0]["score"] == pytest.approx(2.0 / 61 + 0.5 / 61)


def test_no_input_mutation_returns_new_list(comps):
    """``rrf_fuse`` returns a NEW list, never an alias of either input.

    Asserts OBJECT IDENTITY (``fused is not`` each input), not just element
    equality — a fused list that is literally one of the inputs would let the
    caller mutate the other channel's data.
    """
    mod = _retriever_module()
    dense = [_mk_result("a")]
    bm25 = [_mk_result("b")]
    fused = mod.rrf_fuse(
        dense,
        bm25,
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert fused is not dense
    assert fused is not bm25
    # And the inputs are not mutated by the call.
    assert [r["doc"].id for r in dense] == ["a"]
    assert [r["doc"].id for r in bm25] == ["b"]


def test_dense_empty_bm25_rescues(comps):
    """The signature case for a lexical channel: dense finds nothing, BM25 does."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [],
        [_mk_result("a"), _mk_result("b")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert {r["doc"].id for r in fused} == {"a", "b"}
    assert fused[0]["score"] == pytest.approx(1 / 61)  # "a" rank-1 BM25


def test_empty_input_returns_empty(comps):
    """No results in either channel → an empty fused list."""
    mod = _retriever_module()
    assert mod.rrf_fuse([], [], k=60, dense_weight=1.0, lexical_weight=1.0) == []


def test_dedup_within_channel_keeps_best_rank(comps):
    """A duplicate id within one channel is not double-counted (best rank wins)."""
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a"), _mk_result("a")],
        [],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert len(fused) == 1
    assert fused[0]["score"] == pytest.approx(1 / 61)  # rank-1 only


def test_cross_channel_collection_prefixed_key_dedup(comps):
    """``COLLECTION/_key`` and bare ``_key`` for the same doc dedup across channels.

    ``_normalize_chunk_id`` strips the ``COLLECTION/`` prefix before cross-channel
    matching. If a re-graft regresses that normalization, the same document
    would be counted once per channel — its fused score inflated.
    """
    mod = _retriever_module()
    fused = mod.rrf_fuse(
        [_mk_result("a")],
        [_mk_result("GRAPH_SOURCE/a")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert len(fused) == 1
    assert fused[0]["doc"].id == "a"
    assert fused[0]["score"] == pytest.approx(1 / 61 + 1 / 61)


def test_unkeyed_doc_kept_standalone(comps):
    """A doc with no normalizable ``_key`` is kept standalone, never merged.

    Asserts the actual id SET (not just a length count): the unkeyed doc keeps
    its ``None`` id and the keyed doc keeps its own id — neither is dropped nor
    mis-merged with the other.
    """
    mod = _retriever_module()
    none_doc = _FakeDoc(id=None)
    fused = mod.rrf_fuse(
        [{"doc": none_doc, "score": 0.0}],
        [_mk_result("a")],
        k=60,
        dense_weight=1.0,
        lexical_weight=1.0,
    )
    assert {r["doc"].id for r in fused} == {None, "a"}
    assert len(fused) == 2  # unkeyed doc kept standalone, "a" separate


# --- in-image: hybrid invoke still fuses + default is ON ---------------------


def test_invoke_hybrid_path_calls_rrf_fuse_and_flag_on(comps):
    """``invoke`` still fuses via ``rrf_fuse`` AND the hybrid default is ON.

    Two pins in one: a regression that drops the ``rrf_fuse(`` call from the
    hybrid path (or silently flips ``HYBRID_RETRIEVAL_ENABLED`` off) would pass
    the pure tests while silently disabling fusion. The call site lives in the
    retriever re-graft, not in langchain-arangodb — this is the guard against
    the re-graft breaking it.
    """
    mod = _retriever_module()
    cls = getattr(mod, "GenieaiArangoRetriever", None)
    assert cls is not None, "retriever class missing from the real module"
    assert hasattr(cls, "invoke"), "retriever invoke missing from the real module"
    src = inspect.getsource(cls.invoke)
    assert "rrf_fuse(" in src, "hybrid fusion call missing from the retriever invoke"
    assert mod.HYBRID_RETRIEVAL_ENABLED is True, "hybrid retrieval default flipped OFF"
