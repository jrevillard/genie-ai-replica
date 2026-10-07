# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the chatqna → retriever filter-label encoding contract.

See core/label_contract.py for the format documentation. These tests guarantee
the encode/decode roundtrip is correct + edge cases are handled.

Story 1.0b — the graph-names carrier (LG-5 launch gate): the parallel
``::graphs:`` segment rides the same search_start string and must coexist
with the labels segment without interference. Proves the data contract BEFORE
Story 1.1 fan-out code lands.
"""

from core.label_contract import (
    decode,
    decode_filter_labels,
    decode_no_legacy,
    decode_sticky,
    encode,
    encode_filter_labels,
)


class TestEncodeFilterLabels:
    def test_basic_encoding(self):
        assert encode_filter_labels("chunk", ["Onion"]) == "chunk::labels:Onion"

    def test_multiple_labels(self):
        result = encode_filter_labels("chunk", ["Onion", "Vegetables"])
        assert result == "chunk::labels:Onion,Vegetables"

    def test_preserves_base_mode(self):
        assert encode_filter_labels("node", ["X"]).startswith("node::labels:")

    def test_empty_labels_returns_base_unchanged(self):
        assert encode_filter_labels("chunk", []) == "chunk"

    def test_none_or_whitespace_labels_filtered(self):
        assert encode_filter_labels("chunk", ["", "  ", None]) == "chunk"  # type: ignore[list-item]

    def test_labels_stripped(self):
        result = encode_filter_labels("chunk", ["  Onion  ", "Tomato"])
        assert result == "chunk::labels:Onion,Tomato"

    def test_single_label(self):
        assert encode_filter_labels("chunk", ["Onion"]) == "chunk::labels:Onion"


class TestDecodeFilterLabels:
    def test_basic_decoding(self):
        mode, labels = decode_filter_labels("chunk::labels:Onion")
        assert mode == "chunk"
        assert labels == ["Onion"]

    def test_multiple_labels(self):
        mode, labels = decode_filter_labels("chunk::labels:Onion,Vegetables")
        assert mode == "chunk"
        assert labels == ["Onion", "Vegetables"]

    def test_no_labels_returns_empty(self):
        mode, labels = decode_filter_labels("chunk")
        assert mode == "chunk"
        assert labels == []

    def test_preserves_non_chunk_base_mode(self):
        mode, labels = decode_filter_labels("node::labels:X")
        assert mode == "node"
        assert labels == ["X"]

    def test_strips_whitespace_in_labels(self):
        mode, labels = decode_filter_labels("chunk::labels: Onion , Tomato ")
        assert labels == ["Onion", "Tomato"]

    def test_empty_label_string_after_separator(self):
        mode, labels = decode_filter_labels("chunk::labels:")
        assert mode == "chunk"
        assert labels == []

    def test_handles_non_string_input(self):
        mode, labels = decode_filter_labels(123)  # type: ignore[arg-type]
        assert mode == "123"
        assert labels == []


class TestRoundtrip:
    def test_roundtrip_single_label(self):
        encoded = encode_filter_labels("chunk", ["Onion"])
        mode, labels = decode_filter_labels(encoded)
        assert mode == "chunk"
        assert labels == ["Onion"]

    def test_roundtrip_multiple_labels(self):
        original_labels = ["Onion", "Vegetables", "Pest/ Disease Health"]
        encoded = encode_filter_labels("chunk", original_labels)
        mode, labels = decode_filter_labels(encoded)
        assert mode == "chunk"
        assert labels == original_labels

    def test_roundtrip_preserves_base_mode(self):
        encoded = encode_filter_labels("edge", ["X", "Y"])
        mode, labels = decode_filter_labels(encoded)
        assert mode == "edge"
        assert labels == ["X", "Y"]

    def test_roundtrip_empty_labels_no_encoding(self):
        encoded = encode_filter_labels("chunk", [])
        mode, labels = decode_filter_labels(encoded)
        assert mode == "chunk"
        assert labels == []


class TestMultiCategoryLabels:
    """Multi-crop queries (categoryLabels as a list)."""

    def test_encode_multiple_category_labels(self):
        result = encode_filter_labels("chunk", ["Tomato", "Cucumber"])
        assert result == "chunk::labels:Tomato,Cucumber"

    def test_decode_multiple_category_labels(self):
        mode, labels = decode_filter_labels("chunk::labels:Tomato,Cucumber")
        assert mode == "chunk"
        assert labels == ["Tomato", "Cucumber"]

    def test_roundtrip_multi_crop(self):
        crops = ["Tomato", "Cucumber", "Onion"]
        encoded = encode_filter_labels("chunk", crops)
        mode, labels = decode_filter_labels(encoded)
        assert mode == "chunk"
        assert labels == crops

    def test_single_crop_still_works(self):
        encoded = encode_filter_labels("chunk", ["Tomato"])
        mode, labels = decode_filter_labels(encoded)
        assert labels == ["Tomato"]


# ─── Story 1.0b: graph_names carrier ─────────────────────────────────────────
# The new combined encode/decode MUST coexist with the existing labels carrier
# without breaking it. The back-compat shims above stay identical; these tests
# pin the new shape and the order-insensitive dual-segment behaviour.


class TestEncodeGraphNames:
    def test_graphs_only_no_labels(self):
        assert encode("chunk", graphs=["GRAPH", "OKF_kenya-gov_v3"]) == ("chunk::graphs:GRAPH,OKF_kenya-gov_v3")

    def test_graphs_and_labels_both_present(self):
        result = encode("chunk", labels=["Onion"], graphs=["GRAPH", "OKF_kenya-gov_v3"])
        assert result == "chunk::labels:Onion::graphs:GRAPH,OKF_kenya-gov_v3"

    def test_graphs_segment_order_insensitive(self):
        # both orderings must round-trip to the same pair of lists
        a = encode("chunk", labels=["Onion"], graphs=["GRAPH", "OKF_kenya-gov_v3"])
        b = "chunk::graphs:GRAPH,OKF_kenya-gov_v3::labels:Onion"
        assert decode(a) == decode(b)

    def test_empty_graphs_omits_segment(self):
        assert encode("chunk", labels=["Onion"], graphs=[]) == "chunk::labels:Onion"

    def test_none_graphs_omits_segment(self):
        assert encode("chunk", labels=["Onion"], graphs=None) == "chunk::labels:Onion"

    def test_whitespace_only_graphs_filtered(self):
        assert encode("chunk", graphs=["", "  ", None]) == "chunk"  # type: ignore[list-item]

    def test_graphs_stripped(self):
        result = encode("chunk", graphs=["  GRAPH  ", "OKF_kenya-gov_v3"])
        assert result == "chunk::graphs:GRAPH,OKF_kenya-gov_v3"

    def test_no_segments_returns_base_mode_unchanged(self):
        assert encode("chunk") == "chunk"
        assert encode("node") == "node"
        assert encode("edge") == "edge"


class TestDecodeGraphNames:
    def test_graphs_only(self):
        mode, labels, graphs = decode("chunk::graphs:GRAPH,OKF_kenya-gov_v3")
        assert mode == "chunk"
        assert labels == []
        assert graphs == ["GRAPH", "OKF_kenya-gov_v3"]

    def test_labels_and_graphs_both_decoded(self):
        mode, labels, graphs = decode("chunk::labels:Onion,Vegetables::graphs:GRAPH,OKF_kenya-gov_v3")
        assert mode == "chunk"
        assert labels == ["Onion", "Vegetables"]
        assert graphs == ["GRAPH", "OKF_kenya-gov_v3"]

    def test_legacy_input_still_works(self):
        # any segment missing ⇒ empty list (legacy chat keeps running unchanged)
        mode, labels, graphs = decode("chunk")
        assert mode == "chunk"
        assert labels == []
        assert graphs == []

    def test_segment_order_does_not_matter(self):
        a = decode("chunk::labels:Onion::graphs:GRAPH")
        b = decode("chunk::graphs:GRAPH::labels:Onion")
        assert a == b == ("chunk", ["Onion"], ["GRAPH"])

    def test_handles_none_input(self):
        # mirrors the legacy shim's behaviour — None ⇒ empty string (not
        # "None"); callers always pass a string
        mode, labels, graphs = decode(None)  # type: ignore[arg-type]
        assert mode == ""
        assert labels == []
        assert graphs == []

    def test_empty_segment_after_marker(self):
        mode, labels, graphs = decode("chunk::graphs:")
        assert mode == "chunk"
        assert labels == []
        assert graphs == []


class TestGraphNamesRoundtrip:
    def test_graphs_roundtrip(self):
        original = ["GRAPH", "OKF_kenya-gov_v3", "OKF_health-services_v1"]
        encoded = encode("chunk", graphs=original)
        _, _, decoded = decode(encoded)
        assert decoded == original

    def test_labels_and_graphs_roundtrip(self):
        labels = ["Onion", "Vegetables"]
        graphs = ["GRAPH", "OKF_kenya-gov_v3"]
        encoded = encode("edge", labels=labels, graphs=graphs)
        m, dl, dg = decode(encoded)
        assert m == "edge"
        assert dl == labels
        assert dg == graphs


class TestLegacyBackCompat:
    """The encode_filter_labels / decode_filter_labels shims must remain
    BYTE-IDENTICAL to the pre-1.0b contract — every existing chatqna/retriever
    call site keeps running unchanged."""

    def test_encode_shim_matches_legacy(self):
        assert encode_filter_labels("chunk", ["Onion"]) == "chunk::labels:Onion"
        assert encode_filter_labels("node", ["X", "Y"]) == "node::labels:X,Y"
        assert encode_filter_labels("chunk", []) == "chunk"

    def test_decode_shim_returns_two_tuple(self):
        mode, labels = decode_filter_labels("chunk::labels:Onion")
        assert mode == "chunk"
        assert labels == ["Onion"]

    def test_decode_shim_ignores_graph_segment(self):
        # legacy callers (which don't know about graph_names) must NOT see
        # graphs leaking into the labels list
        mode, labels = decode_filter_labels("chunk::graphs:GRAPH")
        assert mode == "chunk"
        assert labels == []


# ─── Story 1.1: the ::no_legacy: signal segment ──────────────────────────────
# okf_only means OKF only (resolved Open Question, 2026-10-06): the BFF emits
# the segment whenever the runtime mode is okf_only; the retriever's legacy
# fallback refuses to run when it reads true. The segment never changes the
# fan-out ENGAGEMENT decision (that stays graph-count driven).


class TestNoLegacyCarrier:
    def test_encode_no_legacy_true_roundtrip(self):
        encoded = encode("chunk", graphs=["OKF_a_v1", "OKF_b_v2"], no_legacy=True)
        assert encoded == "chunk::graphs:OKF_a_v1,OKF_b_v2::no_legacy:true"
        mode, labels, graphs = decode(encoded)
        assert (mode, labels, graphs) == ("chunk", [], ["OKF_a_v1", "OKF_b_v2"])
        assert decode_no_legacy(encoded) is True

    def test_decode_peels_no_legacy_segment(self):
        # a bare segment decodes cleanly; a non-true value is treated as absent
        assert decode("chunk::no_legacy:true") == ("chunk", [], [])
        assert decode_no_legacy("chunk::no_legacy:true") is True
        assert decode("chunk::no_legacy:false") == ("chunk", [], [])
        assert decode_no_legacy("chunk::no_legacy:false") is False
        assert decode_no_legacy("chunk") is False

    def test_no_legacy_default_false_produces_pre_extension_segments(self):
        # default False = byte-identical to the pre-1.1 contract
        assert encode("chunk") == "chunk"
        assert encode("chunk", labels=["L1"]) == "chunk::labels:L1"
        assert encode("chunk", graphs=["GRAPH"]) == "chunk::graphs:GRAPH"
        assert encode("chunk", labels=["L1"], graphs=["GRAPH"]) == "chunk::labels:L1::graphs:GRAPH"

    def test_no_legacy_coexists_with_graphs_and_labels_order_insensitive(self):
        s = encode("chunk", labels=["L1", "L2"], graphs=["GRAPH", "OKF_a_v1"], no_legacy=True)
        assert s == "chunk::labels:L1,L2::graphs:GRAPH,OKF_a_v1::no_legacy:true"
        # both orderings round-trip to the same tuple + flag
        reordered = "chunk::no_legacy:true::labels:L1,L2::graphs:GRAPH,OKF_a_v1"
        assert decode(s) == decode(reordered) == ("chunk", ["L1", "L2"], ["GRAPH", "OKF_a_v1"])
        assert decode_no_legacy(s) is True
        assert decode_no_legacy(reordered) is True


# ─── Story 1.3: the ::sticky: continuity segment ────────────────────────────
class TestStickySegment:
    """Sticky = conversation-routed graph names the retriever must search
    unconditionally (affinity-routing continuity). Additive: carriers without
    the segment decode byte-identically to pre-1.3."""

    def test_encode_sticky_roundtrip(self):
        encoded = encode("chunk", graphs=["GRAPH", "OKF_a_v1"], sticky=["OKF_a_v1"])
        assert encoded == "chunk::graphs:GRAPH,OKF_a_v1::sticky:OKF_a_v1"
        assert decode_sticky(encoded) == ["OKF_a_v1"]

    def test_encode_sticky_omitted_when_empty(self):
        assert encode("chunk", graphs=["OKF_a_v1"]) == "chunk::graphs:OKF_a_v1"
        assert decode_sticky("chunk::graphs:OKF_a_v1") == []

    def test_sticky_alone(self):
        encoded = encode("chunk", sticky=["OKF_a_v1", "OKF_b_v2"])
        assert encoded == "chunk::sticky:OKF_a_v1,OKF_b_v2"
        assert decode_sticky(encoded) == ["OKF_a_v1", "OKF_b_v2"]

    def test_sticky_order_insensitive_multi_segment(self):
        encoded = "chunk::sticky:OKF_b_v2::graphs:GRAPH,OKF_a_v1::no_legacy:true::labels:Onion"
        base, labels, graphs = decode(encoded)
        assert base == "chunk"
        assert labels == ["Onion"]
        assert graphs == ["GRAPH", "OKF_a_v1"]
        assert decode_sticky(encoded) == ["OKF_b_v2"]
        assert decode_no_legacy(encoded) is True

    def test_decode_legacy_carrier_has_no_sticky(self):
        # A pre-1.3 carrier must parse with an empty sticky set — the additive
        # contract keeps every old producer/consumer pair working.
        assert decode_sticky("chunk::graphs:GRAPH,OKF_a_v1::no_legacy:true") == []
        assert decode_sticky("chunk") == []
