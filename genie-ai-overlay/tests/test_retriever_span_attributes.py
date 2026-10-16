# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for retrieval parameters, per-candidate scores and traversal state.

Before this, a trace could say a search happened and how many chunks came back,
but not whether a label filter was active, what ranked the candidates, or
whether graph traversal ran at all.

The score arrays are ALIGNED BY CONSTRUCTION. ``rrf_fuse`` returns a new list,
sorted by fused score, de-duplicated, and possibly containing BM25-only chunks
the dense leg never saw -- so emitting the pre-fusion dense leg beside the fused
order would make index ``i`` of two attributes describe different chunks.
Confidently wrong data is worse than absent data.
"""

import ast
import os
import pathlib
from unittest import mock
from unittest.mock import MagicMock, patch

import pytest

import retriever.genieai_retriever_arangodb as retriever_module
from core.label_contract import encode_filter_labels
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import assert_no_free_text, label_digest
from retriever.genieai_retriever_arangodb import (
    _retrieval_parameter_attributes,
    _retrieval_score_attributes,
)
from tests.test_retriever import _make_happy_path_db, _make_mock_vector_db, create_mock_input, create_retriever


@pytest.fixture
def invoke_env():
    """The mocked ArangoDB + embedding + vector-store environment invoke() needs.

    Built from the SAME helpers tests/test_retriever.py's ``invoke_env`` fixture
    uses rather than imported: importing a fixture under the name its tests use
    as a parameter is F811 on every one of those signatures, and suppressing
    that on a dozen lines would hide a genuine shadowing bug if one appeared.
    """
    db = _make_happy_path_db()
    retriever = create_retriever(db_mock=db)
    embeddings = MagicMock()
    embeddings.embed_query.return_value = [0.1] * 768
    vector_db = _make_mock_vector_db(db)
    patches = [
        patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings", return_value=embeddings),
        patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=vector_db),
        patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
        patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
        patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
        patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
    ]
    for started in patches:
        started.start()
    yield {"db": db, "retriever": retriever, "embeddings": embeddings, "vector_db": vector_db}
    for started in patches:
        started.stop()


class _FakeDoc:
    """Stand-in for a langchain ``Document`` (a MagicMock under conftest)."""

    def __init__(self, id=None, page_content="", metadata=None):
        self.id = id
        self.page_content = page_content
        self.metadata = metadata if metadata is not None else {}


class TestRetrievalParameters:
    def test_records_the_decoded_search_start_not_the_encoded_form(self):
        attrs = _retrieval_parameter_attributes(
            {"fetch_k": 32, "search_type": "mmr", "k": 3},
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["rag_search_start_base"]] == "chunk"
        assert attrs[A["rag_fetch_k"]] == 32
        assert attrs[A["rag_search_type"]] == "mmr"

    def test_absent_fields_get_safe_defaults(self):
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=[])
        assert attrs[A["rag_fetch_k"]] == 0
        assert attrs[A["rag_search_type"]] == "default"


class TestLabelDigests:
    def test_present_labels(self):
        labels = ["Onion", "Vegetables"]
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=labels)
        assert attrs[A["rag_filter_labels_enabled"]] is True
        assert attrs[A["rag_filter_label_count"]] == 2
        assert attrs[A["rag_filter_label_digests"]] == [
            label_digest("Onion"),
            label_digest("Vegetables"),
        ]

    def test_empty_labels_are_reported_not_omitted(self):
        """The label-free query is the common case; it must still be recorded."""
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=[])
        assert attrs[A["rag_filter_labels_enabled"]] is False
        assert attrs[A["rag_filter_label_count"]] == 0
        assert list(attrs[A["rag_filter_label_digests"]]) == []

    def test_label_values_never_appear_raw(self):
        labels = ["Soil Management", "Irrigation Scheduling"]
        attrs = _retrieval_parameter_attributes({}, base_mode="chunk", labels=labels)
        serialized = repr(attrs)
        assert "Soil Management" not in serialized
        assert "Irrigation Scheduling" not in serialized


class TestTraversalDefaults:
    def test_disabled_traversal_still_reports_its_counters(self):
        """Distinguish 'off' from 'on but found nothing'."""
        attrs = _retrieval_parameter_attributes({"enable_traversal": "false"}, base_mode="chunk", labels=[])
        assert attrs[A["traversal_enabled"]] is False
        assert attrs[A["traversal_injected_docs"]] == 0
        assert attrs[A["traversal_injected_neighbor_items"]] == 0

    def test_bool_true_is_accepted(self):
        """Production passes a bool, not a string."""
        attrs = _retrieval_parameter_attributes({"enable_traversal": True}, base_mode="chunk", labels=[])
        assert attrs[A["traversal_enabled"]] is True

    def test_string_true_is_accepted(self):
        attrs = _retrieval_parameter_attributes({"enable_traversal": "true"}, base_mode="chunk", labels=[])
        assert attrs[A["traversal_enabled"]] is True

    def test_knobs_are_recorded(self):
        attrs = _retrieval_parameter_attributes(
            {
                "enable_traversal": True,
                "traversal_max_depth": 2,
                "traversal_max_returned": 5,
                "traversal_score_threshold": 0.4,
            },
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["traversal_max_depth"]] == 2
        assert attrs[A["traversal_max_returned"]] == 5
        assert attrs[A["traversal_score_threshold"]] == 0.4

    def test_string_valued_knobs_do_not_crash_the_request(self):
        """``model_dump`` can hand back strings for numeric fields."""
        attrs = _retrieval_parameter_attributes(
            {"traversal_max_depth": "2", "traversal_score_threshold": "0.4"},
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["traversal_max_depth"]] == 2
        assert attrs[A["traversal_score_threshold"]] == 0.4

    def test_unparseable_knobs_degrade_to_zero_rather_than_raising(self):
        """The emission must never turn a weird request into a 500."""
        attrs = _retrieval_parameter_attributes(
            {"traversal_max_depth": "deep", "fetch_k": "many"},
            base_mode="chunk",
            labels=[],
        )
        assert attrs[A["traversal_max_depth"]] == 0
        assert attrs[A["rag_fetch_k"]] == 0


class TestScoreAlignment:
    def _attrs(self, keys, dense_by_id, present, bm25_by_id=None, fused=None):
        return _retrieval_score_attributes(
            keys=keys,
            dense_by_id=dense_by_id,
            dense_present=present,
            bm25_by_id=bm25_by_id,
            fused=fused,
        )

    def test_arrays_are_index_aligned_to_candidate_keys(self):
        keys = ["a", "b", "c"]
        attrs = self._attrs(
            keys,
            {"a": 0.9, "b": 0.5, "c": 0.1},
            [True, True, True],
            fused=[0.03, 0.02, 0.01],
        )
        assert attrs[A["rag_candidate_keys"]] == keys
        assert attrs[A["rag_scores_dense"]] == [0.9, 0.5, 0.1]
        assert attrs[A["rag_scores_fused"]] == [0.03, 0.02, 0.01]

    def test_fused_order_reorders_every_leg(self):
        """The dense leg arrives in a different order than the fused result."""
        attrs = self._attrs(
            ["b", "a"],
            {"a": 0.9, "b": 0.5},
            [True, True],
            fused=[0.03, 0.02],
        )
        assert attrs[A["rag_scores_dense"]] == [0.5, 0.9]

    def test_bm25_only_chunk_is_flagged_absent_from_the_dense_leg(self):
        attrs = self._attrs(
            ["a", "bm25only"],
            {"a": 0.9},
            [True, False],
            bm25_by_id={"bm25only": 1.2, "a": 0.4},
            fused=[0.03, 0.02],
        )
        assert attrs[A["rag_scores_dense"]] == [0.9, 0.0]
        assert attrs[A["rag_scores_dense_present"]] == [True, False]
        assert attrs[A["rag_scores_bm25"]] == [0.4, 1.2]

    def test_every_emitted_array_has_the_length_of_the_key_array(self):
        """Length equality is what makes index alignment meaningful."""
        keys = ["a", "b", "c", "d"]
        attrs = self._attrs(
            keys,
            {"a": 0.9, "c": 0.2},
            [True, False, True, False],
            bm25_by_id={"b": 1.5, "d": 0.1},
            fused=[0.04, 0.03, 0.02, 0.01],
        )
        for name in (
            "rag_candidate_keys",
            "rag_scores_dense",
            "rag_scores_dense_present",
            "rag_scores_bm25",
            "rag_scores_fused",
        ):
            assert len(attrs[A[name]]) == len(keys), name

    def test_bm25_and_fused_omitted_when_absent(self):
        attrs = self._attrs(["a"], {"a": 0.5}, [True])
        assert A["rag_scores_bm25"] not in attrs
        assert A["rag_scores_fused"] not in attrs

    def test_ceiling_is_capped_and_flagged(self):
        ceiling = retriever_module.SCORE_ARRAY_CEILING
        keys = [f"k{i}" for i in range(ceiling + 20)]
        attrs = self._attrs(keys, {k: 0.5 for k in keys}, [True] * len(keys))
        assert len(attrs[A["rag_scores_dense"]]) == ceiling
        assert len(attrs[A["rag_candidate_keys"]]) == ceiling
        assert len(attrs[A["rag_scores_dense_present"]]) == ceiling
        assert attrs[A["rag_scores_capped"]] is True

    def test_capped_flag_survives_truncating_the_fused_and_bm25_legs_too(self):
        ceiling = retriever_module.SCORE_ARRAY_CEILING
        keys = [f"k{i}" for i in range(ceiling + 5)]
        attrs = self._attrs(
            keys,
            {k: 0.5 for k in keys},
            [True] * len(keys),
            bm25_by_id={k: 0.25 for k in keys},
            fused=[0.03] * len(keys),
        )
        assert len(attrs[A["rag_scores_bm25"]]) == ceiling
        assert len(attrs[A["rag_scores_fused"]]) == ceiling
        assert attrs[A["rag_scores_capped"]] is True

    def test_at_the_ceiling_nothing_is_capped(self):
        keys = [f"k{i}" for i in range(retriever_module.SCORE_ARRAY_CEILING)]
        attrs = self._attrs(keys, {k: 0.5 for k in keys}, [True] * len(keys))
        assert attrs[A["rag_scores_capped"]] is False

    def test_empty_candidate_list(self):
        attrs = self._attrs([], {}, [])
        assert attrs[A["rag_scores_dense"]] == []
        assert attrs[A["rag_scores_capped"]] is False


class TestCeilingIsDerivedFromTheDeployment:
    """The ceiling must track the deployment, not a literal in the source.

    The plan's version of this test asserted ``source_key or True``, which is a
    tautology: it passes whether or not anything reads the variable. Re-derived
    here by locating the module-level assignment with ``ast`` and EVALUATING it
    under a patched environment -- so a hard-coded ceiling, a ceiling reading a
    variable nobody sets, or a ceiling read from the wrong variable all fail.
    """

    ENV_KEY = "RETRIEVER_ARANGO_FETCH_K"

    def _evaluate_ceiling_expression(self, env: dict) -> int:
        source = pathlib.Path(retriever_module.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        assignments = [
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "SCORE_ARRAY_CEILING" for t in node.targets)
        ]
        assert len(assignments) == 1, "SCORE_ARRAY_CEILING must be assigned exactly once, at module level"
        expression = ast.Expression(assignments[0].value)
        ast.fix_missing_locations(expression)
        with mock.patch.dict(os.environ, env, clear=True):
            namespace = {"os": os, "HYBRID_BM25_CANDIDATES": retriever_module.HYBRID_BM25_CANDIDATES}
            namespace["DEFAULT_RETRIEVER_FETCH_K"] = retriever_module.DEFAULT_RETRIEVER_FETCH_K
            return int(eval(compile(expression, "<score-array-ceiling>", "eval"), namespace))

    def test_the_ceiling_expression_reads_the_real_fetch_k_variable(self):
        """``RETRIEVER_FETCH_K`` is the chatqna CONSTANT; the deployment
        variable is ``RETRIEVER_ARANGO_FETCH_K`` (retriever/config.py, chatqna
        line 503 and docker-compose). A ceiling reading anything else -- the
        brief's ``RETRIEVER_FETCH_K``, say -- would be pinned to its default in
        every deployment, which is the exact failure this ceiling exists to
        prevent."""
        # Unset env -> the declared default, plus the BM25 candidate width so
        # the hybrid leg is not capped below the candidates it produces.
        assert self._evaluate_ceiling_expression({}) == (
            retriever_module.DEFAULT_RETRIEVER_FETCH_K + max(0, retriever_module.HYBRID_BM25_CANDIDATES)
        )
        # Patching only the REAL variable must move the ceiling.
        raised = self._evaluate_ceiling_expression({self.ENV_KEY: "96"})
        lowered = self._evaluate_ceiling_expression({self.ENV_KEY: "8"})
        assert raised > lowered
        # Patching only the brief's wrong variable must NOT move it -- which is
        # how a regression back to ``RETRIEVER_FETCH_K`` is caught.
        assert self._evaluate_ceiling_expression({"RETRIEVER_FETCH_K": "999"}) == self._evaluate_ceiling_expression({})

    def test_the_bm25_candidate_width_participates_in_the_ceiling(self):
        """The fused set holds dense + BM25 candidates, so a fetch_k-only
        ceiling would truncate the hybrid path below its own output."""
        base = self._evaluate_ceiling_expression({self.ENV_KEY: "10"})
        with patch.object(retriever_module, "HYBRID_BM25_CANDIDATES", 0):
            assert self._evaluate_ceiling_expression({self.ENV_KEY: "10"}) == 10
        assert base == 10 + retriever_module.HYBRID_BM25_CANDIDATES

    def test_raising_the_deployment_fetch_k_raises_the_ceiling(self):
        default = self._evaluate_ceiling_expression({})
        raised = self._evaluate_ceiling_expression({self.ENV_KEY: str(default + 40)})
        assert raised > default

    def test_ceiling_is_never_below_one(self):
        assert self._evaluate_ceiling_expression({self.ENV_KEY: "0"}) >= 1

    def test_the_imported_constant_matches_the_expression_under_this_environment(self):
        assert self._evaluate_ceiling_expression(dict(os.environ)) == retriever_module.SCORE_ARRAY_CEILING


class TestPrivacy:
    def test_no_free_text_in_retrieval_attributes(self):
        assert_no_free_text(
            _retrieval_parameter_attributes(
                {"search_type": "mmr"},
                base_mode="chunk",
                labels=["Soil Management"],
            )
        )

    def test_score_attributes_pass_the_guard(self):
        assert_no_free_text(
            _retrieval_score_attributes(
                ["a", "b"],
                {"a": 0.9},
                [True, False],
                {"b": 1.1},
                [0.03, 0.02],
            )
        )


# ---------------------------------------------------------------------------
# Wiring: drive the REAL invoke() and assert on the exported span.
# ---------------------------------------------------------------------------
#
# The helper tests above stay green if every emission site is deleted from
# ``invoke`` -- which is the defect class this change exists to prevent, and the
# finding Task 1 and Task 2's reviews both raised. These tests run the real
# ``GenieaiArangoRetriever.invoke`` against the existing mocked ArangoDB /
# embedding stack from tests/test_retriever.py and read the finished, exported
# ``retriever.hybrid_search`` span.
#
# ``create_mock_input`` is the shared helper there; its ``model_dump`` drives
# every field ``invoke`` reads, including ``search_start``, which is what
# ``decode_filter_labels`` splits into base mode plus encoded labels.


class TestParameterWiring:
    @pytest.mark.asyncio
    async def test_dense_only_query_records_the_parameters(self, invoke_env, captured_spans):
        await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk", k=4, fetch_k=20))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["rag_search_start_base"]] == "chunk"
        assert attrs[A["rag_search_type"]] == "similarity_score_threshold"
        assert attrs[A["rag_fetch_k"]] == 20
        assert attrs[A["rag_filter_labels_enabled"]] is False
        assert attrs[A["rag_filter_label_count"]] == 0
        assert list(attrs[A["rag_filter_label_digests"]]) == []

    @pytest.mark.asyncio
    async def test_parameters_are_recorded_on_a_label_free_query(self, invoke_env, captured_spans):
        """Regression guard for the original defect: emitting inside
        ``if _encoded_labels:`` would set NOTHING on every label-free query --
        most production traffic, and precisely the case where "did the filter
        silently not apply?" is the question being asked."""
        with patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False):
            await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk"))
        (span,) = captured_spans("retriever.hybrid_search")
        assert A["rag_filter_labels_enabled"] in span.attributes
        assert span.attributes[A["rag_filter_labels_enabled"]] is False

    @pytest.mark.asyncio
    async def test_encoded_labels_are_reported_as_digests_only(self, invoke_env, captured_spans):
        input_mock = create_mock_input(search_start="chunk")
        input_mock.model_dump.return_value["search_start"] = encode_filter_labels("chunk", ["Soil Management"])
        await invoke_env["retriever"].invoke(input_mock)
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["rag_filter_labels_enabled"]] is True
        assert attrs[A["rag_filter_label_count"]] == 1
        assert list(attrs[A["rag_filter_label_digests"]]) == [label_digest("Soil Management")]
        assert "Soil Management" not in repr(dict(attrs))


class TestScoreWiring:
    @pytest.mark.asyncio
    async def test_dense_only_query_emits_aligned_arrays(self, invoke_env, captured_spans):
        retriever = invoke_env["retriever"]
        vdb = invoke_env["vector_db"]
        docs = [
            _FakeDoc(id="chunkA", page_content="a", metadata={}),
            _FakeDoc(id="chunkB", page_content="b", metadata={}),
        ]
        vdb.asimilarity_search_with_relevance_scores.return_value = [(docs[0], 0.9), (docs[1], 0.4)]
        await retriever.invoke(create_mock_input(search_start="chunk", k=2))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert list(attrs[A["rag_candidate_keys"]]) == ["chunkA", "chunkB"]
        assert list(attrs[A["rag_scores_dense"]]) == [0.9, 0.4]
        assert list(attrs[A["rag_scores_dense_present"]]) == [True, True]
        # No BM25 channel ran, so no bm25/fused arrays -- omitted, not nulled.
        assert A["rag_scores_bm25"] not in attrs
        assert A["rag_scores_fused"] not in attrs

    @pytest.mark.asyncio
    async def test_hybrid_path_aligns_every_leg_to_the_fused_order(self, invoke_env, captured_spans):
        """The fused ordering must drive EVERY array, not just the keys.

        Three candidates, and the fused order is NOT the pre-fusion dense order:
        dense returns [chunkA, chunkC]; BM25 returns [chunkB, chunkA] where
        chunkB never reached the dense leg. Weighted RRF with equal leg weights
        gives chunkA both a dense and a lexical rank, so it wins; chunkB
        (lexical only) outranks chunkC (dense only, lower rank).

        A site that emitted the pre-fusion dense list beside the fused scores
        would put chunkC at index 1 of the key array and chunkB at index 1 of the
        BM25 array -- index i of two attributes describing different chunks, with
        every array the right LENGTH, so no length check would notice.
        """
        retriever = invoke_env["retriever"]
        vdb = invoke_env["vector_db"]
        chunk_a = _FakeDoc(id="chunkA", page_content="dense", metadata={})
        chunk_c = _FakeDoc(id="chunkC", page_content="dense", metadata={})
        chunk_b = _FakeDoc(id="chunkB", page_content="bm25-only", metadata={})
        vdb.asimilarity_search_with_relevance_scores.return_value = [(chunk_a, 0.9), (chunk_c, 0.7)]
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch.object(
                retriever,
                "_bm25_search",
                return_value=[{"doc": chunk_b, "score": 1.5}, {"doc": chunk_a, "score": 0.3}],
            ),
        ):
            await retriever.invoke(create_mock_input(search_start="chunk", k=2))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        keys = list(attrs[A["rag_candidate_keys"]])
        assert keys == ["chunkA", "chunkB", "chunkC"]
        # chunkB never reached the dense leg: 0.0 with present=False, never
        # another chunk's score at the same index.
        assert list(attrs[A["rag_scores_dense_present"]]) == [True, False, True]
        assert list(attrs[A["rag_scores_dense"]]) == [0.9, 0.0, 0.7]
        assert list(attrs[A["rag_scores_bm25"]]) == [0.3, 1.5, 0.0]
        fused = list(attrs[A["rag_scores_fused"]])
        assert fused == sorted(fused, reverse=True)
        # Every array shares the key array's length -- necessary but NOT
        # sufficient; the value assertions above are what pin the alignment.
        for name in (
            "rag_candidate_keys",
            "rag_scores_dense",
            "rag_scores_dense_present",
            "rag_scores_bm25",
            "rag_scores_fused",
        ):
            assert len(attrs[A[name]]) == len(keys), name

    @pytest.mark.asyncio
    async def test_dense_snapshot_is_taken_when_hybrid_is_off(self, invoke_env, captured_spans):
        """The dense snapshot must live OUTSIDE the hybrid block; hybrid is off
        by default, so a snapshot taken inside leaves it undefined on the common
        path."""
        with patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False):
            await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk"))
        (span,) = captured_spans("retriever.hybrid_search")
        assert A["rag_scores_dense"] in span.attributes


class TestTraversalWiring:
    @pytest.mark.asyncio
    async def test_disabled_traversal_reports_zero_counters(self, invoke_env, captured_spans):
        await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk", enable_traversal=False))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["traversal_enabled"]] is False
        assert attrs[A["traversal_injected_docs"]] == 0
        assert attrs[A["traversal_injected_neighbor_items"]] == 0

    @pytest.mark.asyncio
    async def test_enabled_traversal_counts_documents_that_got_content(self, invoke_env, captured_spans):
        retriever = invoke_env["retriever"]
        vdb = invoke_env["vector_db"]
        hit = _FakeDoc(id="chunkA", page_content="dense", metadata={})
        miss = _FakeDoc(id="chunkB", page_content="dense", metadata={})
        vdb.asimilarity_search_with_relevance_scores.return_value = [(hit, 0.9), (miss, 0.4)]
        retriever.fetch_neighborhoods = mock.MagicMock(
            return_value={"chunkA": [{"chunk_text": "neighbour", "file_id": "f1"}], "chunkB": []}
        )
        await retriever.invoke(create_mock_input(search_start="chunk", k=2, enable_traversal=True))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["traversal_enabled"]] is True
        # chunkB's neighborhood was empty -> `continue` -> no content injected.
        assert attrs[A["traversal_injected_docs"]] == 1
        assert attrs[A["traversal_injected_neighbor_items"]] == 1

    @pytest.mark.asyncio
    async def test_enabled_traversal_with_no_hits_differs_from_disabled(self, invoke_env, captured_spans):
        retriever = invoke_env["retriever"]
        retriever.fetch_neighborhoods = mock.MagicMock(return_value={"doc1": None})
        await retriever.invoke(create_mock_input(search_start="chunk", enable_traversal=True))
        (span,) = captured_spans("retriever.hybrid_search")
        attrs = span.attributes
        assert attrs[A["traversal_enabled"]] is True
        assert attrs[A["traversal_injected_docs"]] == 0


class TestEmittedSpanIsClean:
    @pytest.mark.asyncio
    async def test_the_real_span_passes_the_privacy_guard(self, invoke_env, captured_spans):
        await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk"))
        (span,) = captured_spans("retriever.hybrid_search")
        assert_no_free_text(dict(span.attributes))
