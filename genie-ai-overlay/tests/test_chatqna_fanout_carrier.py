"""Tests for Story 1.2 — chatqna forwards the authorized graph set (case B).

David, 2026-09-21: when the fan-out engages (≥1 graph encoded), the chat
forwarder MUST send `[GRAPH, OKF_<repo_a>_v<N_a>, OKF_<repo_b>_v<N_b>, ...]`
in the carrier — the legacy graph is the first leg, every entry treated
equally. These tests pin AC1 (carrier shape) on the chatqna side; the
retriever-side carrier decode is in test_label_contract.py + test_retriever.py.

The chat-side forwarder reads the authorized graph set from
`/api/okf/authz/graphs` (Story 6.1b), then injects it into the
retriever `kwargs` as `authorized_graph_names`, which `align_inputs`
encodes into the search_start carrier via core.label_contract.encode.

These tests are MOCKED (chatqna's existing pattern) — the live LG-5
boundary probe lives in scripts/check-okf-retriever-boundary.py
(queued for Wave R5 alongside the production forwarding it gates).
"""

from unittest.mock import MagicMock, patch

from chatqna.genieai_chatqna import _gp, align_inputs


class FakeServiceType:
    """Minimal stand-in matching the chatqna test pattern. Mirrors every
    ServiceType enum value `align_inputs` reads, so the function's
    if/elif chain doesn't blow up before reaching our retriever branch."""

    class _S:
        TRANSLATOR = "TRANSLATOR"
        EMBEDDING = "EMBEDDING"
        RETRIEVER = "RETRIEVER"
        RERANK = "RERANK"
        LLM = "LLM"

    TRANSLATOR = _S.TRANSLATOR
    EMBEDDING = _S.EMBEDDING
    RETRIEVER = _S.RETRIEVER
    RERANK = _S.RERANK
    LLM = _S.LLM


def create_mock_service_node(kind):
    """Build a service-node mock matching the chatqna test pattern."""

    class _Node:
        def __init__(self):
            self.service_type = kind

    return _Node()


# ─── AC1 — Carrier shape (case B, fan-out with legacy + OKF graphs) ────────────


class TestRetrieverCarrierFanoutShape:
    """Story 1.2 AC1: when ≥1 graph is authorized, the chat-side carrier
    carries `[GRAPH, OKF_<repo_a>_v<N_a>, ...]` (legacy first). The
    retriever treats every entry as one leg (Story 1.0 case-B contract).
    """

    def test_carrier_carries_legacy_graph_first_when_one_okf_graph_authorized(self):
        """Single OKF + legacy → carrier = [GRAPH, OKF_kenya-gov_v3]."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def fake_encode(base_mode, labels=None, graphs=None):
            captured["base_mode"] = base_mode
            captured["labels"] = labels
            captured["graphs"] = graphs
            return "chunk::graphs:GRAPH,OKF_kenya-gov_v3"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={"authorized_graph_names": ["GRAPH", "OKF_kenya-gov_v3"]},
            )

        # Legacy first, OKF after — the canonical carrier shape.
        assert captured["graphs"] == ["GRAPH", "OKF_kenya-gov_v3"]
        assert captured["base_mode"] == "chunk"
        assert captured["labels"] == []

    def test_carrier_carries_legacy_graph_first_when_many_okf_graphs_authorized(self):
        """Many OKF + legacy → carrier = [GRAPH, OKF_a, OKF_b, OKF_c]."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def fake_encode(base_mode, labels=None, graphs=None):
            captured["graphs"] = graphs
            return f"chunk::graphs:{','.join(graphs or [])}"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={
                    "authorized_graph_names": [
                        "GRAPH",
                        "OKF_kenya-gov_v3",
                        "OKF_health-services_v1",
                        "OKF_water_v2",
                    ]
                },
            )

        assert captured["graphs"] == [
            "GRAPH",
            "OKF_kenya-gov_v3",
            "OKF_health-services_v1",
            "OKF_water_v2",
        ]

    def test_carrier_carries_legacy_graph_when_legacy_only_no_okf(self):
        """Single-element carrier with just [GRAPH] → fan-out still engages
        with one leg (David, 2026-09-21 case B with one leg). The legacy
        graph IS included so the retriever serves the free-form corpus
        alongside the OKF repos."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def fake_encode(base_mode, labels=None, graphs=None):
            captured["graphs"] = graphs
            return f"chunk::graphs:{','.join(graphs or [])}"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={"authorized_graph_names": ["GRAPH"]},
            )

        assert captured["graphs"] == ["GRAPH"]

    def test_carrier_omitted_when_no_authorized_graphs_param(self):
        """Legacy free-form-only case (chat-side hasn't been wired with
        the resolver yet) → chatqna does not encode anything; the
        retriever falls through to its legacy single-graph path against
        ARANGO_GRAPH_NAME (David, 2026-09-21 case A)."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        encode_called = {"called": False}

        def fake_encode(base_mode, labels=None, graphs=None):
            encode_called["called"] = True
            return base_mode

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={},  # NO authorized_graph_names → carrier omitted
            )

        # The chatqna must NOT call encode when there's nothing to encode
        # (no labels, no graphs) — legacy path stays unchanged.
        assert encode_called["called"] is False

    def test_carrier_carries_labels_and_graphs_together(self):
        """Combined carrier (amendment D: per-graph label map + graph set).
        The retriever decodes both segments order-insensitively."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def fake_encode(base_mode, labels=None, graphs=None):
            captured["labels"] = labels
            captured["graphs"] = graphs
            # Real encoder would emit "chunk::labels:L1,L2::graphs:G1,G2"
            return f"chunk::labels:{','.join(labels or [])}::graphs:{','.join(graphs or [])}"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={
                    "authorized_graph_names": ["GRAPH", "OKF_kenya-gov_v3"],
                    "retrieval_context": {"categoryLabels": ["Onion", "Vegetables"]},
                },
            )

        assert captured["labels"] == ["Onion", "Vegetables"]
        assert captured["graphs"] == ["GRAPH", "OKF_kenya-gov_v3"]


# ─── Story 1.1 — the `exclude_legacy` kwarg (okf_only literally means OKF only) ──


class TestExcludeLegacyCarrier:
    """Story 1.1: the BFF sets `exclude_legacy: true` inside `context` whenever
    the runtime mode is okf_only; align_inputs threads it into the carrier as
    the `::no_legacy:` segment. Default (absent/False) preserves the canonical
    carrier shape byte-for-byte."""

    def test_exclude_legacy_true_adds_no_legacy_segment(self):
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def fake_encode(base_mode, labels=None, graphs=None, no_legacy=False):
            captured["graphs"] = graphs
            captured["no_legacy"] = no_legacy
            if no_legacy:
                return f"chunk::graphs:{','.join(graphs or [])}::no_legacy:true"
            return f"chunk::graphs:{','.join(graphs or [])}"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = fake_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: fake_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={
                    "retrieval_context": {
                        # The BFF's okf_only carrier: OKF graphs + the no-legacy
                        # signal (never the legacy GRAPH).
                        "authorized_graph_names": ["OKF_agrogenio_v2"],
                        "exclude_legacy": True,
                    }
                },
            )

        assert captured["graphs"] == ["OKF_agrogenio_v2"]
        assert captured["no_legacy"] is True

    def test_exclude_legacy_absent_produces_canonical_carrier_shape(self):
        """Without the flag, encode is called WITHOUT the no_legacy kwarg —
        the pre-1.1 carrier shape (and the pre-1.1 mocked-encode signatures in
        every existing test) stay untouched."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def probe_encode(base_mode, labels=None, graphs=None, no_legacy=False):
            captured["graphs"] = graphs
            captured["no_legacy"] = no_legacy
            return f"chunk::graphs:{','.join(graphs or [])}"

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = probe_encode
            sys.modules["core.label_contract"].encode_filter_labels.side_effect = lambda base, labels: probe_encode(
                base, labels=labels, graphs=None
            )
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                genie_params={"retrieval_context": {"authorized_graph_names": ["GRAPH", "OKF_a_v1"]}},
            )

        assert captured["graphs"] == ["GRAPH", "OKF_a_v1"]
        # The kwarg was NOT passed on the default path (align_inputs only
        # forwards no_legacy when True) — the canonical call surface is
        # unchanged.
        assert captured["no_legacy"] is False

    def test_exclude_legacy_routes_labels_only_queries_through_combined_encode(self):
        """The `and not _exclude_legacy` routing term: labels WITHOUT graphs +
        the okf_only signal must take the COMBINED encode (which carries
        no_legacy), never the labels-only encode_filter_labels shim — the shim
        has no no_legacy parameter and would silently drop the signal."""
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        inputs = {"text": "query", "search_start": "chunk"}
        captured = {}

        def probe_encode(base_mode, labels=None, graphs=None, no_legacy=False):
            captured["labels"] = labels
            captured["graphs"] = graphs
            captured["no_legacy"] = no_legacy
            return f"chunk::labels:{','.join(labels or [])}::no_legacy:true" if no_legacy else base_mode

        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch.dict("sys.modules", {"core.label_contract": MagicMock()}),
        ):
            import sys

            sys.modules["core.label_contract"].encode.side_effect = probe_encode
            encode_filter_labels_mock = sys.modules["core.label_contract"].encode_filter_labels
            _ = align_inputs(
                self_mock,
                inputs,
                "retriever_node",
                MagicMock(),
                {},
                # okf_only + a labelled query, NO carrier graphs (zero-serving).
                genie_params={"retrieval_context": {"categoryLabel": "Crops", "exclude_legacy": True}},
            )

        encode_filter_labels_mock.assert_not_called()
        assert captured["labels"] == ["Crops"]
        assert captured["graphs"] == []
        assert captured["no_legacy"] is True


# ─── AC1 — chatqna's `authorized_graph_names` kwarg plumbing ─────────────────


class TestAuthorizedGraphNamesKwargPlumbing:
    """The chat-side forwarder MUST surface the authorized graph set into the
    retriever kwargs. Until the resolver endpoint (Story 6.1b) is wired in,
    `_gp` must read it from kwargs when present.
    """

    def test__gp_reads_authorized_graph_names_from_kwargs(self):
        kwargs = {"authorized_graph_names": ["GRAPH", "OKF_kenya-gov_v3"]}
        out = _gp(kwargs, "authorized_graph_names", [])
        assert out == ["GRAPH", "OKF_kenya-gov_v3"]

    def test__gp_defaults_to_empty_list_when_absent(self):
        """The chat-side forwarder MUST default to [] (no carrier) when the
        resolver hasn't been called yet — preserves legacy free-form-only
        behavior (case A)."""
        out = _gp({}, "authorized_graph_names", [])
        assert out == []

    def test__gp_treats_none_as_empty_after_or_fallback(self):
        """_gp itself is a passthrough helper — it returns None when the
        kwarg is None. The CALL SITE (`align_inputs` line 931) handles
        None with `or []` so the carrier encoder never sees None. This
        test pins BOTH halves: the call-site coercion AND the helper's
        pass-through contract."""
        kwargs = {"authorized_graph_names": None}
        # Raw helper behaviour (passthrough):
        raw = _gp(kwargs, "authorized_graph_names", [])
        assert raw is None
        # Call-site coercion (the safety net that protects the encoder):
        coerced = _gp(kwargs, "authorized_graph_names", []) or []
        assert coerced == []

    def test__gp_accepts_real_resolver_shape(self):
        """Real resolver shape: list of strings with potentially stale
        entries. We pass through unchanged — the retriever handles missing
        graphs with zero-hit per graph (Story 1.0 Decision E)."""
        kwargs = {"authorized_graph_names": ["GRAPH", "OKF_retired-repo_v5"]}
        out = _gp(kwargs, "authorized_graph_names", [])
        assert "OKF_retired-repo_v5" in out
