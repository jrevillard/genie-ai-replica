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


class TestLabelsContainingTheSeparator:
    """A label may contain the character that separates two labels.

    The hierarchy is server-side and free text: ``Births, Deaths and Marriages``
    is a real category name, so the encoding must not read it as two labels.
    """

    def test_label_with_a_comma_survives_the_encoding(self):
        encoded = encode_filter_labels("chunk", ["Births, Deaths and Marriages", "Taxes"])
        base_mode, labels = decode_filter_labels(encoded)
        assert base_mode == "chunk"
        assert labels == ["Births, Deaths and Marriages", "Taxes"]

    def test_the_decoded_labels_are_the_strings_the_retriever_filters_on(self):
        """The retriever matches ``chunk_labels`` verbatim — the decoded value
        must be the original label, not its encoded form."""
        original = ["Births, Deaths and Marriages", "Taxes & Revenue", "Maize"]
        _, labels = decode_filter_labels(encode_filter_labels("chunk", original))
        assert labels == original


class TestBackwardCompatibleEncoding:
    """The encoding must not break a retriever that predates it — for the
    labels whose characters it does not escape.

    The chatqna and the retriever are deployed independently, so during a
    rolling upgrade a new chatqna talks to a retriever that does not know
    about the escaping yet. That retriever splits the label list on the comma
    and takes the parts verbatim. The encoding is therefore ASYMMETRIC on
    purpose: a label without a comma is wire-compatible with the old decoder
    (spaces, &, accents travel verbatim), while a comma label is NOT — the
    old decoder reads it as two labels, which is precisely why the escaping
    exists and why a rolling upgrade must not be attempted mid-rename.
    """

    def test_a_label_with_a_space_is_encoded_verbatim(self):
        assert encode_filter_labels("chunk", ["Tax Payment"]) == "chunk::labels:Tax Payment"

    def test_a_label_with_an_ampersand_is_encoded_verbatim(self):
        assert encode_filter_labels("chunk", ["Taxes & Revenue"]) == "chunk::labels:Taxes & Revenue"

    def test_a_comma_label_is_the_one_thing_a_retriever_predating_the_escaping_cannot_read(self):
        """The honest statement of the rolling-upgrade boundary.

        A legacy decoder splits the wire on the raw comma, so the escaped
        label comes out as two strings that match no chunk. This is not a
        defect to fix in the encoder — the alternative (percent-encoding
        every label) breaks the legacy decoder for EVERY label.
        """
        encoded = encode_filter_labels("chunk", ["Births, Deaths and Marriages"])
        assert encoded == "chunk::labels:Births%2C Deaths and Marriages"

        legacy_parts = encoded.split("::labels:", 1)[1].split(",")
        assert any(part.startswith("Births%2C") for part in legacy_parts)
        assert "Births, Deaths and Marriages" not in legacy_parts

    def test_the_escape_table_is_exactly_percent_and_comma(self):
        """The wire gives % and , a meaning — those two, and only those two,
        are escaped. Everything else (spaces, &, accents) travels verbatim
        so a retriever predating the escaping still reads it."""
        assert encode_filter_labels("chunk", ["a,b%c"]) == "chunk::labels:a%2Cb%25c"
        assert encode_filter_labels("chunk", ["Tax Payment & Revenue"]) == "chunk::labels:Tax Payment & Revenue"

    def test_a_label_containing_a_percent_sign_round_trips(self):
        original = ["50% Discount"]
        _, labels = decode_filter_labels(encode_filter_labels("chunk", original))
        assert labels == original

    def test_a_label_containing_the_escape_sequence_round_trips(self):
        original = ["Code%2CTest"]
        _, labels = decode_filter_labels(encode_filter_labels("chunk", original))
        assert labels == original

    def test_a_label_containing_the_label_separator_round_trips(self):
        original = ["Taxes::labels:Special"]
        _, labels = decode_filter_labels(encode_filter_labels("chunk", original))
        assert labels == original
