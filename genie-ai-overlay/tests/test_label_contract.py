# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the chatqna → retriever filter-label encoding contract.

See core/label_contract.py for the format documentation. These tests guarantee
the encode/decode roundtrip is correct + edge cases are handled.
"""

from core.label_contract import decode_filter_labels, encode_filter_labels


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
