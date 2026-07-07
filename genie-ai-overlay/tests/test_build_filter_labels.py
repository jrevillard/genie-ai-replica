# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for chatqna._build_filter_labels — the retriever filter-label builder.

Covers the singular/plural categoryLabel contract fix:
- frontend/backend send ``categoryLabel`` (singular, string)
- legacy callers send ``categoryLabels`` (plural, list)
- both must produce a flat filter-label list; null/empty → no filter.
"""

import importlib

# Import lazily so this test file can be collected even if the heavyweight
# chatqna module import has side effects in some environments.
chatqna = importlib.import_module("chatqna.genieai_chatqna")
build = chatqna._build_filter_labels


class TestBuildFilterLabels:
    def test_singular_category_label_coerced_to_list(self):
        result = build({"categoryLabel": "Crops", "serviceLabels": ["Tomato"]})
        assert result == ["Crops", "Tomato"]

    def test_plural_category_labels_still_works(self):
        result = build({"categoryLabels": ["Crops", "Soil"], "serviceLabels": ["Tomato"]})
        assert result == ["Crops", "Soil", "Tomato"]

    def test_singular_category_label_only(self):
        result = build({"categoryLabel": "Crops"})
        assert result == ["Crops"]

    def test_service_labels_only(self):
        result = build({"serviceLabels": ["Tomato", "Onion"]})
        assert result == ["Tomato", "Onion"]

    def test_empty_context_no_filter(self):
        result = build({})
        assert result == []

    def test_none_context_no_filter(self):
        result = build(None)
        assert result == []

    def test_null_category_label_no_filter_for_category(self):
        # categoryLabel null + no serviceLabels → empty (no filter)
        result = build({"categoryLabel": None, "serviceLabels": []})
        assert result == []

    def test_singular_and_plural_both_present(self):
        # Both keys present — both contribute (defensive; unlikely in practice)
        result = build({"categoryLabel": "Crops", "categoryLabels": ["Soil"], "serviceLabels": ["Tomato"]})
        assert result == ["Crops", "Soil", "Tomato"]

    def test_order_category_before_service(self):
        result = build({"serviceLabels": ["ZService"], "categoryLabel": "Acat"})
        assert result == ["Acat", "ZService"]

    def test_dedup_when_singular_and_plural_both_present(self):
        result = build({"categoryLabel": "Crops", "categoryLabels": ["Crops", "Soil"], "serviceLabels": ["Tomato"]})
        assert result == ["Crops", "Soil", "Tomato"]

    def test_dedup_repeated_labels(self):
        result = build({"categoryLabel": "Tomato", "serviceLabels": ["Tomato", "Onion"]})
        assert result == ["Tomato", "Onion"]

    def test_non_string_category_label_coerced(self):
        # Defensive: a malformed client sending a non-string non-list value
        # should not raise TypeError; it gets stringified.
        result = build({"categoryLabel": 123, "serviceLabels": ["Tomato"]})
        assert result == ["123", "Tomato"]
