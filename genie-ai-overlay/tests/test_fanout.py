"""Tests for the additive multi-graph fan-out (Story 1.0/1.1/1.4/1.5).

The orchestrator (`invoke_fanout`) and the per-leg runner (`_invoke_leg`) are
MODULE-level functions taking the retriever explicitly as their first argument
(`invoke_fanout(self, ...)` — the shipped form since Story 1.0's 18b34cd13;
the call site in `invoke()` dispatches module-style for the same reason).
The pure helpers (_fanout_should_engage, _attach_provenance,
_merge_per_graph_results, _legacy_single_graph_or_refuse) are testable in
isolation. This is the layer-1 unit coverage; the live-deploy LG-5 boundary
probe is Wave R5.

The decision matrix is in `_bmad-output/implementation-artifacts/1-0-retriever-provenance-materialization.md`
(Decisions A–F); these tests pin the contract the orchestrator commits to.
"""

from unittest.mock import MagicMock, patch

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

    def test_exclude_legacy_decode_does_not_affect_engagement(self):
        """Story 1.1: the ::no_legacy: carrier segment never changes the
        ENGAGEMENT decision — engagement is driven by the decoded graph list
        alone. no_legacy only governs the legacy FALLBACK (see
        TestLegacyFallbackRefusal below)."""
        from core.label_contract import decode, decode_no_legacy, encode

        encoded = encode("chunk", graphs=["OKF_a_v1"], no_legacy=True)
        _, _, graphs = decode(encoded)
        assert graphs == ["OKF_a_v1"]
        assert decode_no_legacy(encoded) is True
        assert _fanout_should_engage(graphs) is True  # graphs present → engages
        # empty carrier + no_legacy → still bypasses fan-out (→ legacy tail,
        # which then refuses — okf_only zero-serving)
        empty_encoded = encode("chunk", no_legacy=True)
        _, _, empty_graphs = decode(empty_encoded)
        assert empty_graphs == []
        assert _fanout_should_engage(empty_graphs) is False


# ─── Story 1.1: the legacy ARANGO_GRAPH_NAME fallback refusal ────────────────


class TestInvokeLegSpan:
    """Regression pin (live-caught 2026-10-06): `_invoke_leg` must hand
    `_extract_for_graph` a REAL span — the extraction unconditionally sets
    attributes on and ends it, so the shipped `span=None` crashed EVERY leg
    with 'NoneType' object has no attribute 'end' (legs=9, succeeded=0,
    fused=0) after the search had already found hits."""

    async def test_invoke_leg_passes_real_span_not_none(self):
        from retriever.genieai_retriever_arangodb import _invoke_leg

        captured = {}

        async def fake_extract(self, **kwargs):
            captured.update(kwargs)
            return [{"doc": "hit"}]

        stub = type("StubRetriever", (), {"_extract_for_graph": fake_extract})()
        with patch("tracing.get_tracer") as mock_get_tracer:
            mock_get_tracer.return_value.start_span.return_value = MagicMock()
            result = await _invoke_leg(
                stub,
                graph_name="OKF_x_v1",
                input_dict={"input": "q"},
                input=None,
                query="q",
            )

        assert result == [{"doc": "hit"}]
        assert captured["span"] is not None
        assert captured["span"] is mock_get_tracer.return_value.start_span.return_value
        assert captured["graph_name"] == "OKF_x_v1"


class TestPerGraphCandidateCap:
    """Story 1.5 tiered option-(d) caps (review 2026-10-29 round 3): the
    per-graph cap must pre-truncate each leg's candidate list BEFORE cross-
    graph fusion (Level-2) — without that tier one large graph floods fusion
    up to the global cap and crowds every other graph out. The global cap
    (target_k in invoke_fanout) still applies on top."""

    @staticmethod
    def _per_graph_counts(fused):
        counts = {}
        for item in fused:
            graph = item["doc"].id.rsplit("-", 1)[0]
            counts[graph] = counts.get(graph, 0) + 1
        return counts

    async def _fanout(self, per_graph_cap, global_cap, leg_sizes, k=10):
        """invoke_fanout through the REAL _invoke_leg (stubbed extraction,
        routing skipped — no embedding), with both cap knobs patched."""
        import retriever.genieai_retriever_arangodb as mod

        async def fake_extract(self, **kwargs):
            n = leg_sizes[kwargs["graph_name"]]
            return [{"doc": _StubDoc(f"{kwargs['graph_name']}-{i}", {}), "score": 0.0} for i in range(n)]

        stub = type("StubRetriever", (), {"_extract_for_graph": fake_extract})()
        input = MagicMock()
        input.embedding = None  # routing skipped → full carrier
        input.k = k
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "FANOUT_CANDIDATE_CAP_PER_GRAPH", per_graph_cap),
            patch.object(mod, "FANOUT_CANDIDATE_CAP_GLOBAL", global_cap),
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            fused = await mod.invoke_fanout(stub, input, {"text": "q"}, ["GRAPH", "OKF_a_v1", "OKF_b_v1"])
        return fused

    async def test_leg_hits_precapped_per_graph_before_fusion(self):
        # per-graph 2 binds (global 200 does not): each leg may contribute at
        # most 2 candidates → fused 6, not the uncapped 13.
        fused = await self._fanout(2, 200, {"GRAPH": 5, "OKF_a_v1": 4, "OKF_b_v1": 4})
        assert len(fused) == 6
        counts = self._per_graph_counts(fused)
        assert all(n <= 2 for n in counts.values()), counts

    async def test_global_cap_still_applies_above_per_graph_cap(self):
        # per-graph 50 is generous (nothing truncated), global 3 binds:
        # target_k = min(k=10, 3) → fused 3.
        fused = await self._fanout(50, 3, {"GRAPH": 5, "OKF_a_v1": 5})
        assert len(fused) == 3

    async def test_invoke_leg_returns_precapped_list(self):
        """Direct pin on the per-graph boundary: `_invoke_leg` returns the
        top-ranked per-graph slice, and returns shorter lists untouched."""
        import retriever.genieai_retriever_arangodb as mod
        from retriever.genieai_retriever_arangodb import _invoke_leg

        async def fake_extract(self, **kwargs):
            n = kwargs["input_dict"].get("n", 5)
            return [{"doc": _StubDoc(f"c{i}", {}), "score": 0.0} for i in range(n)]

        stub = type("StubRetriever", (), {"_extract_for_graph": fake_extract})()
        with (
            patch.object(mod, "FANOUT_CANDIDATE_CAP_PER_GRAPH", 2),
            patch("tracing.get_tracer") as mock_get_tracer,
        ):
            mock_get_tracer.return_value.start_span.return_value = MagicMock()
            result = await _invoke_leg(stub, graph_name="OKF_x_v1", input_dict={"input": "q"}, input=None, query="q")
        assert [item["doc"].id for item in result] == ["c0", "c1"]  # top-ranked kept

        with (
            patch.object(mod, "FANOUT_CANDIDATE_CAP_PER_GRAPH", 2),
            patch("tracing.get_tracer") as mock_get_tracer,
        ):
            mock_get_tracer.return_value.start_span.return_value = MagicMock()
            result_under = await _invoke_leg(
                stub, graph_name="OKF_x_v1", input_dict={"input": "q", "n": 1}, input=None, query="q"
            )
        assert [item["doc"].id for item in result_under] == ["c0"]  # below cap → untouched


class TestDedicatedExtractionPool:
    """DW-424 (review 2026-10-29 round 3): a timed-out leg is ABANDONED and
    its thread keeps running — that slot must come out of the dedicated
    bounded pool (okf-extract), never the shared default executor that every
    other to_thread user in the process depends on. The leg runner and the
    routing probes both route there."""

    async def test_invoke_leg_runs_on_the_dedicated_pool(self):
        import threading

        from retriever.genieai_retriever_arangodb import _invoke_leg

        seen = {}

        async def fake_extract(self, **kwargs):
            seen["thread"] = threading.current_thread().name
            return [{"doc": "hit"}]

        stub = type("StubRetriever", (), {"_extract_for_graph": fake_extract})()
        with patch("tracing.get_tracer") as mock_get_tracer:
            mock_get_tracer.return_value.start_span.return_value = MagicMock()
            result = await _invoke_leg(stub, graph_name="OKF_x_v1", input_dict={"input": "q"}, input=None, query="q")
        assert result == [{"doc": "hit"}]
        assert seen["thread"].startswith("okf-extract"), seen["thread"]

    async def test_route_probes_run_on_the_dedicated_pool(self):
        import threading

        from retriever.genieai_retriever_arangodb import _route_graphs

        seen = []

        class ProbeThreadDb:
            def __init__(self):
                self.aql = self

            def execute(self, aql, bind_vars=None):
                kind = "heads" if "okf_repositories" in aql else "probe"
                seen.append((kind, threading.current_thread().name))
                if kind == "heads":
                    return iter([])  # the head fetch runs inline on the loop
                return iter([0.9, 0.9, 0.9])

        stub = type("StubRetriever", (), {"db": ProbeThreadDb()})()
        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(stub, ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"], [0.1] * 8)
        assert degraded is False
        probe_threads = [name for kind, name in seen if kind == "probe"]
        assert probe_threads and all(name.startswith("okf-extract") for name in probe_threads)


class TestLegacyFallbackRefusal:
    """The no-carrier tail of invoke() (`_legacy_single_graph_or_refuse`):
    run the legacy extraction against ARANGO_GRAPH_NAME — or refuse it when
    the carrier carries the ::no_legacy: signal (okf_only literally means OKF
    only — resolved Open Question, 2026-10-06)."""

    @staticmethod
    def _stub_retriever(calls):
        async def fake_extract(self, **kwargs):
            calls.append(kwargs)
            return [{"doc": "hit"}]

        return type("StubRetriever", (), {"_extract_for_graph": fake_extract})()

    async def test_legacy_fallback_refused_when_exclude_legacy_true(self):
        from retriever.genieai_retriever_arangodb import _legacy_single_graph_or_refuse

        calls = []
        stub = self._stub_retriever(calls)
        span = MagicMock()
        result = await _legacy_single_graph_or_refuse(
            stub,
            input_dict={},
            input=None,
            query="q",
            start_time=0.0,
            span=span,
            exclude_legacy=True,
        )
        # zero hits from any graph; the legacy extraction NEVER ran
        assert result == []
        assert calls == []
        span.end.assert_called_once()

    async def test_legacy_fallback_runs_against_arango_graph_name_when_not_excluded(self):
        from retriever.genieai_retriever_arangodb import ARANGO_GRAPH_NAME, _legacy_single_graph_or_refuse

        calls = []
        stub = self._stub_retriever(calls)
        span = MagicMock()
        result = await _legacy_single_graph_or_refuse(
            stub,
            input_dict={"search_start": "chunk"},
            input=None,
            query="q",
            start_time=0.0,
            span=span,
            exclude_legacy=False,
        )
        assert result == [{"doc": "hit"}]
        assert len(calls) == 1
        assert calls[0]["graph_name"] == ARANGO_GRAPH_NAME
        span.end.assert_not_called()  # the extraction owns the span (finally)


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


# ─── Story 1.3: query-affinity graph routing (global chunk competition) ─────
class _StubRoutingDb:
    """db handle stub: aql.execute serves per-collection probe rows from a dict;
    a collection absent from the dict raises (simulates probe failure).

    Story 1-8 MR-D: the head-affinity query (``okf_repositories``) is served
    from the optional ``heads`` list when provided; a RuntimeError on it when
    ``heads`` is the sentinel "fail" (best-effort fetch must not degrade)."""

    def __init__(self, results, heads=None):
        self._results = results
        self._heads = heads
        self.calls = []
        self.aql = self

    def execute(self, aql, bind_vars=None):
        self.calls.append(bind_vars)
        if "okf_repositories" in aql:
            if self._heads == "fail":
                raise RuntimeError("head fetch failed")
            return iter(self._heads or [])
        coll = aql.split("`")[1]
        rows = self._results.get(coll)
        if rows is None:
            raise RuntimeError(f"probe failed for {coll}")
        return iter(rows)


def _routing_stub(results, heads=None):
    return type("StubRetriever", (), {"db": _StubRoutingDb(results, heads)})()


class TestRouteGraphs:
    """Story 1.3 policy pins: >=3-chunks qualification, top-1 floor, retry-
    then-degrade, legacy GRAPH passthrough."""

    async def test_qualification_by_chunk_count(self):
        from retriever.genieai_retriever_arangodb import _route_graphs

        # alphabet contributes 5 of the global rows, kenya 4, ncd 1 →
        # {alphabet, kenya} qualify; ncd dropped (singletons cut).
        results = {
            "OKF_alphabet_v1_SOURCE": [0.9, 0.89, 0.88, 0.87, 0.86],
            "OKF_kenya_v1_SOURCE": [0.85, 0.84, 0.83, 0.82],
            "OKF_ncd_v1_SOURCE": [0.80],
        }
        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(
                _routing_stub(results),
                ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1", "OKF_ncd_v1"],
                [0.1] * 8,
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"]

    async def test_floor_top1_when_nothing_qualifies(self):
        from retriever.genieai_retriever_arangodb import _route_graphs

        # Every graph contributes exactly 1 chunk → nothing meets >=3 → the
        # floor routes to the single best graph. NEVER zero.
        results = {
            "OKF_alphabet_v1_SOURCE": [0.95],
            "OKF_kenya_v1_SOURCE": [0.60],
        }
        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(
                _routing_stub(results), ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"], [0.1] * 8
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]

    async def test_probe_failure_degrades_to_full_carrier(self):
        from retriever.genieai_retriever_arangodb import _route_graphs

        # Every probe raises on every attempt → degraded=True, ALL graphs
        # searched (the only sanctioned all-graph path).
        carrier = ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"]
        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(_routing_stub({}), carrier, [0.1] * 8)
        assert degraded is True
        assert routed == carrier

    async def test_retry_succeeds_without_degrade(self):
        from retriever.genieai_retriever_arangodb import _route_graphs

        # First attempt fails for kenya, retry succeeds → NOT degraded.
        calls = {"n": 0}

        class FlakyDb:
            def __init__(self):
                self.aql = self

            def execute(self, aql, bind_vars=None):
                coll = aql.split("`")[1]
                if coll == "OKF_kenya_v1_SOURCE":
                    calls["n"] += 1
                    if calls["n"] == 1:
                        raise RuntimeError("transient")
                    return iter([0.9, 0.9, 0.9])
                return iter([0.5, 0.5, 0.5])

        stub = type("StubRetriever", (), {"db": FlakyDb()})()
        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(stub, ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"], [0.1] * 8)
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1"]

    # ─── Story 1-8 MR-D: vectorized-head affinity in the global pool ────────

    def _head_rows(self, g="OKF_ncd_v1", dim=8, model="BAAI/bge-large-en-v1.5", vector=None, fv=None, fvs=None):
        # Story 1-8b: the head-fetch AQL always returns the gate inputs —
        # ``fv`` the averaged forbidden centroid (null when the head has
        # none) and ``fvs`` the per-tag forbidden_vectors ([] when absent).
        # The defaults mirror that shape: no centroid, no per-tag vectors.
        return [{"g": g, "v": vector or [0.5] * dim, "fv": fv, "fvs": fvs or [], "dim": dim, "model": model}]

    async def _route(self, stub, graphs, emb=None):
        routed, degraded, _route_span = await self._route_with_span(stub, graphs, emb)
        return routed, degraded

    async def _route_with_span(self, stub, graphs, emb=None):
        """Route and also return the mock route span, for set_attribute pins."""
        from retriever.genieai_retriever_arangodb import _route_graphs

        with patch("tracing.get_tracer") as mock_tracer:
            mock_tracer.return_value.start_span.return_value = MagicMock()
            routed, degraded = await _route_graphs(stub, graphs, emb or [0.1] * 8)
        return routed, degraded, mock_tracer.return_value.start_span.return_value

    @staticmethod
    def _span_attrs(route_span):
        """Flatten the mock span's set_attribute calls into a dict."""
        return {call.args[0]: call.args[1] for call in route_span.set_attribute.call_args_list}

    async def test_head_pseudo_row_lights_up_its_graph(self):
        # ncd has only 2 chunks (< ROUTE_MIN_CHUNKS) but a strong head
        # (cosine 1.0 passes all three gate legs — no centroid/tags → veto
        # and margin degrade open): the claim is DECISIVE under heads-
        # supersede (1-8f3) — ncd routes, and alphabet's 5 chunks do NOT
        # keep it in (a claiming head silences the chunk competition).
        # This is David's "CLEARLY IT SHOULD HAVE HIT NCD (only)" ruling.
        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93, 0.92, 0.91],
            "OKF_kenya_v1_SOURCE": [0.85, 0.84],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        routed, degraded = await self._route(
            _routing_stub(results, heads=self._head_rows()),
            ["GRAPH", "OKF_alphabet_v1", "OKF_kenya_v1", "OKF_ncd_v1"],
        )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]

    async def test_supersede_skips_the_chunk_probe(self):
        # 1-8f3 latency contract: under an active claim the per-graph probe
        # NEVER runs — the db sees ONLY the okf_repositories head fetch (the
        # live probe across ~100k-chunk graphs cost 78s of a 122s answer).

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93, 0.92, 0.91],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        stub = _routing_stub(results, heads=self._head_rows())
        routed, degraded = await self._route(stub, ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"])
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        assert stub.db.calls and all("okf_repositories" in str(call) or call is None for call in stub.db.calls), (
            f"probe ran under an active claim: {stub.db.calls}"
        )

    async def test_supersede_excludes_the_legacy_graph_leg(self):
        # 1-8f3 (live 2026-10-10): 20 unrelated legacy-Kenya GRAPH chunks were
        # the ONLY content reranked for an NCD-routed asthma query when the
        # NCD leg returned 0 documents — grounding verdict 0, general-knowledge
        # fallback. Under an active claim the legacy leg is dropped with the
        # headless OKF graphs; no-claim paths keep it (D8 unchanged there).

        results = {
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
            "GRAPH_SOURCE": [0.9, 0.89, 0.88],
        }
        routed, degraded = await self._route(
            _routing_stub(results, heads=self._head_rows()),
            ["GRAPH", "OKF_ncd_v1"],
        )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        assert "GRAPH" not in routed

    async def test_supersede_off_restores_pool_semantics(self):
        # RETRIEVER_ROUTE_HEADS_SUPERSEDE=false → the 1-8 MR-D pool: the
        # claiming head is one pseudo-row (+1 chunk-count) among chunks —
        # alphabet's 5 chunks keep it in alongside ncd.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93, 0.92, 0.91],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        with patch.object(rmod, "ROUTE_HEADS_SUPERSEDE", False):
            routed, degraded = await self._route(
                _routing_stub(results, heads=self._head_rows()),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"]

    async def test_head_weight_zero_disables_the_signal(self):
        # Same universe, RETRIEVER_ROUTE_HEAD_WEIGHT=0.0 (rollback knob) →
        # no pseudo-row → ncd dropped again (2 chunks < 3).
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93, 0.92, 0.91],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        with patch.object(rmod, "ROUTE_HEAD_WEIGHT", 0.0):
            routed, degraded = await self._route(
                _routing_stub(results, heads=self._head_rows()),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]

    async def test_head_dim_mismatch_is_skipped(self):
        # A head of a different dimension than the query embedding is skipped
        # (guard) — no pseudo-row, ncd stays at 2 chunks → dropped.
        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        routed, degraded = await self._route(
            _routing_stub(results, heads=self._head_rows(dim=4)),
            ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
        )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]

    async def test_head_fetch_failure_never_degrades(self):
        # The head query itself raises — routing continues on the probe
        # results alone (best-effort, NOT the degraded path).
        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        routed, degraded = await self._route(
            _routing_stub(results, heads="fail"),
            ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
        )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]

    # ─── Story 1-8b: the forbidden/noise gate (FLOOR + per-tag VETO) ────────
    # David, 2026-10-09: "forbidden is forbidden — a hard contract, it should
    # immediately score zero." A head CLAIMS the query only when ALL of:
    #   FLOOR  — cosine(q, head) >= ROUTE_HEAD_FLOOR (unrelated queries score
    #            0.32-0.48 on ANY head; margin-only let "capital of France"
    #            claim NCD at +0.012),
    #   VETO   — no single per-tag vector in head.per_field.forbidden_vectors
    #            matches the query at/above ROUTE_FORBIDDEN_TAG_MAX
    #            (mixed-subject queries slip the averaged centroid but not
    #            their dominant tag),
    #   MARGIN — cosine(q, head) - cosine(q, forbidden centroid) >
    #            ROUTE_HEAD_MARGIN (the 1-8a rule, now the third leg).
    # Degradation: heads without per-tag vectors skip the veto; heads without
    # a forbidden centroid skip the margin. All gate knobs are patched
    # explicitly (the module reads its config imports at call time — same
    # mechanism as test_head_weight_zero_disables_the_signal), and the vectors
    # are built on the basis query _E0 so every cosine is hand-checkable:
    # cos(_E0, w) = w[0] / |w|.

    # Basis query embedding — every gate cosine below reads off w[0] / |w|.
    _E0 = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    async def test_head_below_floor_is_floored(self):
        # cos(_E0, [0.5]*8) = 1/√8 ≈ 0.354 < 0.55 → the head scores ZERO
        # (heads_floored) — the "capital of France" class that margin-only
        # let through at +0.012. ncd stays at 2 chunks → dropped; alphabet's
        # 3 chunks still qualify.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=self._head_rows(vector=[0.5] * 8)),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_floored"] == 1
        assert attrs["rag.route.head_rows"] == 0
        assert attrs["rag.route.heads_vetoed"] == 0

    async def test_head_vetoed_by_dominant_forbidden_tag(self):
        # Floor passes (cos 1.0), margin skipped (no centroid), but ONE
        # per-tag vector — "genetics" at cos 0.6 — reaches the veto ceiling:
        # the head scores ZERO (heads_vetoed) and ncd (2 chunks, no vote)
        # stays dropped. This is the mixed-subject class ("genetics + cancer")
        # that slips the averaged centroid but not its dominant tag.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(
            vector=list(self._E0),
            fvs=[{"tag": "genetics", "vector": [0.6, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]}],
        )
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_vetoed"] == 1
        assert attrs["rag.route.heads_floored"] == 0
        assert attrs["rag.route.head_rows"] == 0

    async def test_veto_ignores_tags_below_the_ceiling(self):
        # Same head shape, but the only tag vector scores 1/√8 ≈ 0.354 —
        # below the ceiling → no veto. The per-tag list EXISTING at all must
        # not suppress a legitimate claim: ncd gets the pseudo-row → 3
        # chunks → qualifies.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(vector=list(self._E0), fvs=[{"tag": "genetics", "vector": [0.5] * 8}])
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_vetoed"] == 0
        assert attrs["rag.route.head_rows"] == 1

    async def test_all_gates_pass_head_row_injected(self):
        # The affirmative claim, all three legs: FLOOR 1.0 >= 0.55, VETO tag
        # at 0.354 < 0.55, MARGIN 1.0 - 0.354 = 0.646 > 0.01 over the averaged
        # centroid → pseudo-row injected → ncd qualifies.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(
            vector=list(self._E0),
            fv=[0.5] * 8,
            fvs=[{"tag": "genetics", "vector": [0.5] * 8}],
        )
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.mode"] == "heads-supersede"
        assert attrs["rag.route.head_rows"] == 1
        assert attrs["rag.route.heads_gated"] == 0
        assert attrs["rag.route.heads_floored"] == 0
        assert attrs["rag.route.heads_vetoed"] == 0

    async def test_margin_over_centroid_gates_head_1_8a(self):
        # The 1-8a margin leg pinned (previously untested): the head claims at
        # cos 1.0 and floor passes, but the averaged forbidden centroid sits
        # at cos ≈ 0.995 — 1.0 - 0.995 = 0.005 <= 0.01 → heads_gated, no
        # vote, ncd stays dropped.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(vector=list(self._E0), fv=[1.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_gated"] == 1
        assert attrs["rag.route.head_rows"] == 0
        assert attrs["rag.route.heads_floored"] == 0
        assert attrs["rag.route.heads_vetoed"] == 0

    async def test_degradation_no_forbidden_vectors_skips_veto(self):
        # Pre-1-8b head — per_field.forbidden_vectors absent, so the fetch
        # AQL's `|| []` yields an EMPTY list: the veto leg is skipped
        # entirely. The identical head that
        # test_head_vetoed_by_dominant_forbidden_tag suppresses now claims.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(vector=list(self._E0), fvs=[])
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_vetoed"] == 0
        assert attrs["rag.route.head_rows"] == 1

    async def test_degradation_no_centroid_skips_margin(self):
        # Head without a forbidden centroid (fv null): the margin leg is
        # skipped (the 1-8a "gate degrades open" semantics). The identical
        # head+centroid pair that test_margin_over_centroid_gates_head_1_8a
        # suppresses now claims — margin needs a centroid to compare against.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        heads = self._head_rows(vector=list(self._E0), fv=None, fvs=[])
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.55),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.55),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_gated"] == 0
        assert attrs["rag.route.head_rows"] == 1

    async def test_gate_boundaries_floor_inclusive_veto_inclusive(self):
        # Boundary semantics: the floor is INCLUSIVE (a head scoring EXACTLY
        # the floor is not floored — the drop is strictly-less) and the veto
        # ceiling is INCLUSIVE (a tag at EXACTLY the ceiling vetoes — the
        # code vetoes on >=). Both knobs pinned at 0.6 and [0.6, 0.8, 0…] is
        # a unit vector, so head and tag both score EXACTLY 0.6: the head
        # passes the floor, the tag vetoes it.
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_alphabet_v1_SOURCE": [0.95, 0.94, 0.93],
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
        }
        unit06 = [0.6, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        heads = self._head_rows(vector=unit06, fvs=[{"tag": "genetics", "vector": list(unit06)}])
        with (
            patch.object(rmod, "ROUTE_HEAD_FLOOR", 0.6),
            patch.object(rmod, "ROUTE_FORBIDDEN_TAG_MAX", 0.6),
            patch.object(rmod, "ROUTE_HEAD_MARGIN", 0.01),
        ):
            routed, degraded, span = await self._route_with_span(
                _routing_stub(results, heads=heads),
                ["GRAPH", "OKF_alphabet_v1", "OKF_ncd_v1"],
                emb=self._E0,
            )
        assert degraded is False
        assert routed == ["GRAPH", "OKF_alphabet_v1"]
        attrs = self._span_attrs(span)
        assert attrs["rag.route.heads_floored"] == 0  # 0.6 == floor → passed the floor
        assert attrs["rag.route.heads_vetoed"] == 1  # 0.6 == ceiling → vetoed
        assert attrs["rag.route.head_rows"] == 0


class TestFanoutRoutingHook:
    """Story 1.3 — the invoke_fanout hook: routed set + sticky union; GRAPH
    always searched; routing skipped when disabled / no embedding / <2 OKF."""

    def _fanout_stub(self):
        async def fake_leg(self_, graph_name, input_dict, input, query=None):
            return [{"doc": f"hit-{graph_name}"}]

        return type("StubRetriever", (), {"_invoke_leg": fake_leg})()

    async def test_routed_set_prunes_legs_and_sticky_unions(self):
        """Routing dropped OKF_B_v1, but the carrier's ::sticky: restores it —
        the search set is routed ∪ sticky (∪ GRAPH), in carrier order."""
        import retriever.genieai_retriever_arangodb as mod

        seen = []

        async def fake_leg(self_, graph_name, input_dict, input, query=None):
            seen.append(graph_name)
            return [{"doc": f"hit-{graph_name}"}]

        async def fake_route(self_, carrier, emb):
            # Routing qualified only OKF_A_v1; OKF_B_v1 was dropped.
            return ["GRAPH", "OKF_A_v1"], False

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        input = MagicMock()
        input.embedding = [0.1] * 8
        input.k = 10
        input_dict = {
            "search_start": "chunk::graphs:GRAPH,OKF_A_v1,OKF_B_v1::sticky:OKF_B_v1",
            "text": "q",
        }
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs", fake_route),
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1", "OKF_B_v1"])
        assert seen == ["GRAPH", "OKF_A_v1", "OKF_B_v1"]

    async def test_sticky_graph_outside_carrier_is_dropped(self):
        """Authorization wins: a sticky graph absent from the carrier's
        authorized set must NEVER be searched."""
        import retriever.genieai_retriever_arangodb as mod

        seen = []

        async def fake_leg(self_, graph_name, input_dict, input, query=None):
            seen.append(graph_name)
            return [{"doc": "h"}]

        async def fake_route(self_, carrier, emb):
            return ["GRAPH", "OKF_A_v1"], False

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        input = MagicMock()
        input.embedding = [0.1] * 8
        input.k = 10
        input_dict = {
            "search_start": "chunk::graphs:GRAPH,OKF_A_v1::sticky:OKF_EVIL_v1",
            "text": "q",
        }
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs", fake_route),
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1"])
        assert seen == ["GRAPH", "OKF_A_v1"]

    async def test_no_embedding_skips_routing(self):
        """No query embedding on the request → full carrier (degrade towards
        recall), _route_graphs never called."""
        import retriever.genieai_retriever_arangodb as mod

        seen = []

        async def fake_leg(self_, graph_name, input_dict, input, query=None):
            seen.append(graph_name)
            return [{"doc": "h"}]

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        input = MagicMock()
        input.embedding = None
        input.k = 10
        input_dict = {"text": "q"}
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs") as mock_route,
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1", "OKF_B_v1"])
        mock_route.assert_not_called()
        assert sorted(seen) == ["GRAPH", "OKF_A_v1", "OKF_B_v1"]

    async def test_routing_disabled_runs_full_carrier(self):
        """RETRIEVER_ROUTE_ENABLED=false → byte-identical full-carrier behavior;
        _route_graphs is never called."""
        import retriever.genieai_retriever_arangodb as mod

        seen = []

        async def fake_leg(self_, graph_name, input_dict, input, query=None):
            seen.append(graph_name)
            return [{"doc": "h"}]

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        input = MagicMock()
        input.embedding = [0.1] * 8
        input.k = 10
        input_dict = {"text": "q"}
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "ROUTE_ENABLED", False),
            patch.object(mod, "_route_graphs") as mock_route,
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1", "OKF_B_v1"])
        mock_route.assert_not_called()
        assert sorted(seen) == ["GRAPH", "OKF_A_v1", "OKF_B_v1"]


class TestFanoutBoundAndFallback:
    """1-8g-l — the traversal can no longer starve a claimed leg.

    Live 2026-10-11 (Indonesia History, 9/9 chat answers ungrounded): each
    claimed leg fused 20 on-point documents, then its traversal overran the
    8s leg budget on a 1,046,217-edge graph; _invoke_leg abandoned the leg
    and DISCARDED the fused docs → fused=0 → the LLM abstained. The fix:
    (a) a graph-size gate (skip traversal above ARANGO_TRAVERSAL_MAX_LINKS),
    (b) per-hop AQL caps + a traversal sub-budget (overrun → continue
    WITHOUT enrichment), (c) a claimed-leg-empty fallback (one vector-only
    retry), (d) the legs= log now counts the search set, not the carrier.
    """

    def _supersede_env(self):
        """A heads-supersede shaped fixture: the claim on OKF_A_v1 dropped
        GRAPH and OKF_B_v1 from the search set (routed == ['OKF_A_v1'])."""
        import retriever.genieai_retriever_arangodb as mod

        async def fake_route(self_, carrier, emb):
            return ["OKF_A_v1"], False

        input = MagicMock()
        input.embedding = [0.1] * 8
        input.k = 10
        input_dict = {"search_start": "chunk::graphs:GRAPH,OKF_A_v1,OKF_B_v1", "text": "q"}
        return mod, fake_route, input, input_dict

    async def test_claimed_leg_starved_falls_back_to_vector_only(self):
        """The decisive claim's leg returns [] (traversal starvation shape) —
        one vector-only retry (enable_traversal forced False, NO second leg
        for GRAPH) rescues the answer instead of shipping fused=0."""
        mod, fake_route, input, input_dict = self._supersede_env()
        calls = []

        async def fake_leg(self_, graph_name, leg_input_dict, input, query=None):
            calls.append((graph_name, dict(leg_input_dict)))
            if len(calls) == 1:
                return []  # first pass: the traversal-starved leg
            return [{"doc": "rescued-borobudur-chunk", "score": 0.9}]

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs", fake_route),
        ):
            span = MagicMock()
            mock_tracer.return_value.start_span.return_value = span
            fused = await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1", "OKF_B_v1"])
        # exactly ONE graph, searched twice (leg pass + vector-only retry);
        # the dropped GRAPH leg never runs.
        assert [g for g, _ in calls] == ["OKF_A_v1", "OKF_A_v1"]
        assert calls[0][1].get("enable_traversal") is not False
        assert calls[1][1].get("enable_traversal") is False
        assert fused, "the fallback must recover documents, not abstain"
        assert span.set_attribute.call_args_list.__contains__(("okf.fanout.leg_empty_fallback", True)) or any(
            c.args == ("okf.fanout.leg_empty_fallback", True) for c in span.set_attribute.call_args_list
        )

    async def test_no_fallback_when_competition_shape_returns_zero(self):
        """When the legacy competition ran (GRAPH present in the search set),
        fused=0 means the competition itself found nothing — no retry."""
        import retriever.genieai_retriever_arangodb as mod

        async def fake_route(self_, carrier, emb):
            return ["GRAPH", "OKF_A_v1"], False

        input = MagicMock()
        input.embedding = [0.1] * 8
        input.k = 10
        input_dict = {"search_start": "chunk::graphs:GRAPH,OKF_A_v1", "text": "q"}
        calls = []

        async def fake_leg(self_, graph_name, leg_input_dict, input, query=None):
            calls.append(graph_name)
            return []

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs", fake_route),
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            fused = await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1"])
        assert fused == []
        assert sorted(calls) == ["GRAPH", "OKF_A_v1"]  # no second round

    async def test_no_fallback_when_legs_succeed(self):
        """A healthy claimed leg never triggers the retry path."""
        mod, fake_route, input, input_dict = self._supersede_env()
        calls = []

        async def fake_leg(self_, graph_name, leg_input_dict, input, query=None):
            calls.append(graph_name)
            return [{"doc": "hit", "score": 0.9}]

        stub = type("StubRetriever", (), {"_invoke_leg": fake_leg})()
        with (
            patch("tracing.get_tracer") as mock_tracer,
            patch.object(mod, "_invoke_leg", fake_leg),
            patch.object(mod, "_route_graphs", fake_route),
        ):
            mock_tracer.return_value.start_span.return_value = MagicMock()
            fused = await mod.invoke_fanout(stub, input, input_dict, ["GRAPH", "OKF_A_v1", "OKF_B_v1"])
        assert calls == ["OKF_A_v1"]  # one pass, no retry
        assert fused

    def test_traversal_skip_reason_size_gate(self):
        """The size gate: graphs above ARANGO_TRAVERSAL_MAX_LINKS sit the
        traversal out; healthy graphs pass; a count failure is NOT a skip."""
        import retriever.genieai_retriever_arangodb as mod

        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_LINKS", 300000):
            huge = MagicMock()
            huge.db.collection.return_value.count.return_value = 1_046_217
            reason = mod.GenieaiArangoRetriever._traversal_skip_reason(
                "OKF_indonesia-history-llm_v1", huge, elapsed_s=0.5, budget_s=6.75
            )
            assert reason is not None and "ARANGO_TRAVERSAL_MAX_LINKS" in reason

            healthy = MagicMock()
            healthy.db.collection.return_value.count.return_value = 80_535
            assert (
                mod.GenieaiArangoRetriever._traversal_skip_reason("OKF_other_v1", healthy, elapsed_s=0.5, budget_s=6.75)
                is None
            )

            broken = MagicMock()
            broken.db.collection.return_value.count.side_effect = RuntimeError("db down")
            assert (
                mod.GenieaiArangoRetriever._traversal_skip_reason("OKF_other_v1", broken, elapsed_s=0.5, budget_s=6.75)
                is None
            )

        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_LINKS", 0):
            unbounded = MagicMock()
            unbounded.db.collection.return_value.count.return_value = 10**9
            assert (
                mod.GenieaiArangoRetriever._traversal_skip_reason("OKF_any_v1", unbounded, elapsed_s=0.5, budget_s=6.75)
                is None
            )

    def test_traversal_skip_reason_budget_exhausted(self):
        """A leg that already burned its budget sits the traversal out even
        below the size gate."""
        import retriever.genieai_retriever_arangodb as mod

        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_LINKS", 300000):
            vb = MagicMock()
            vb.db.collection.return_value.count.return_value = 100
            reason = mod.GenieaiArangoRetriever._traversal_skip_reason(
                "OKF_small_v1", vb, elapsed_s=7.5, budget_s=-0.25
            )
            assert reason is not None and "budget" in reason

    def test_chunk_subquery_carries_edge_cap(self):
        """The traversal AQL interpolates the per-hop edge cap so a hub
        entity cannot submit unbounded cosine evaluations."""
        import retriever.genieai_retriever_arangodb as mod

        stub = type("S", (), {})()
        bind = {}
        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE", 2000):
            q = mod.GenieaiArangoRetriever._build_subquery(
                stub,
                "OKF_g_v1",
                "chunk",
                [0.1] * 8,
                1,
                3,
                0.5,
                None,
                "cosine",
                "COSINE_SIMILARITY",
                "DESC",
                bind,
                "OKF_g_v1_SOURCE",
            )
            assert "LIMIT 2000" in q
            assert "SORT item.score DESC" in q
            assert bind.get("query_embedding") == [0.1] * 8

        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE", 0):
            q_uncapped = mod.GenieaiArangoRetriever._build_subquery(
                stub,
                "OKF_g_v1",
                "chunk",
                [0.1] * 8,
                1,
                3,
                0.5,
                None,
                "cosine",
                "COSINE_SIMILARITY",
                "DESC",
                bind,
                "OKF_g_v1_SOURCE",
            )
            assert "LIMIT 2000" not in q_uncapped  # legacy unbounded shape

    def test_node_subquery_carries_edge_cap(self):
        """Same cap on the node-mode subquery (the compose default mode)."""
        import retriever.genieai_retriever_arangodb as mod

        stub = type("S", (), {})()
        bind = {}
        with patch.object(mod, "ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE", 500):
            q = mod.GenieaiArangoRetriever._build_subquery(
                stub,
                "OKF_g_v1",
                "node",
                [0.1] * 8,
                1,
                3,
                0.5,
                None,
                "cosine",
                "COSINE_SIMILARITY",
                "DESC",
                bind,
                "OKF_g_v1_SOURCE",
            )
            assert "LIMIT 500" in q
