# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for core.label_contract.build_filter_labels — the scope builder.

Covers the singular/plural categoryLabel contract fix:
- frontend/backend send ``categoryLabel`` (singular, string)
- legacy callers send ``categoryLabels`` (plural, list)
- both must produce a flat filter-label list; null/empty → no filter.

The CATEGORY and the SERVICE are two dimensions of the same scope: a service
lives inside a category. The retriever applies its label filter as a UNION of
the labels it receives (``OR`` strategy), so a filter carrying both the
category and the service matches every chunk of the parent category — the
service scope leaks into the whole category. The service labels are therefore
the filter whenever they exist; the category filters on its own.

The builder lives in ``core.label_contract`` so the chatqna (which encodes the
labels) and the retriever (which decodes them) cannot drift apart.
"""

from core.label_contract import build_filter_labels as build


class TestBuildFilterLabels:
    def test_singular_category_label_only(self):
        result = build({"categoryLabel": "Crops"})
        assert result == ["Crops"]

    def test_plural_category_labels_only(self):
        result = build({"categoryLabels": ["Crops", "Soil"]})
        assert result == ["Crops", "Soil"]

    def test_service_labels_only(self):
        result = build({"serviceLabels": ["Tomato", "Onion"]})
        assert result == ["Tomato", "Onion"]

    def test_a_none_service_label_does_not_eclipse_the_declared_category(self):
        # A raw-dict caller can hand a None entry: it is no label at all.
        # The blank-string sibling is tested; None took the service branch
        # too (None != "") and eclipsed the category the same way, then
        # the dedupe dropped it to an empty filter.
        assert build({"categoryLabel": "Healthcare", "serviceLabels": [None]}) == ["Healthcare"]

    def test_a_blank_service_label_does_not_eclipse_the_declared_category(self):
        # A label that is NOTHING (not a whitespace-only one, which is
        # KEPT) is not a scope: taking the service branch for it would
        # return no labels and the query would run unfiltered outside the
        # scope the request declared.
        assert build({"categoryLabel": "Healthcare", "serviceLabels": [""]}) == ["Healthcare"]
        assert build({"categoryLabel": "Healthcare", "serviceLabels": ""}) == ["Healthcare"]

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

    def test_both_category_keys_present_without_service_labels(self):
        # Both keys present and no service label: the category dimension
        # contributes both spellings, deduplicated.
        result = build({"categoryLabel": "Crops", "categoryLabels": ["Crops", "Soil"]})
        assert result == ["Crops", "Soil"]

    def test_the_service_labels_are_the_filter_when_the_category_is_also_given(self):
        """The retriever unions the labels it receives.

        A chunk carries BOTH its category and its service name in
        ``chunk_labels``, so filtering on the category AND the service with an
        OR strategy matches every chunk of the parent category. The service is
        the narrower scope, so it is the one that filters.
        """
        result = build({"serviceLabels": ["ZService"], "categoryLabel": "Acat"})
        assert result == ["ZService"]

    def test_the_service_labels_are_the_filter_when_both_category_keys_are_present(self):
        result = build({"categoryLabel": "Crops", "categoryLabels": ["Soil"], "serviceLabels": ["Tomato"]})
        assert result == ["Tomato"]

    def test_dedup_repeated_labels(self):
        result = build({"categoryLabel": "Tomato", "serviceLabels": ["Tomato", "Onion"]})
        assert result == ["Tomato", "Onion"]

    def test_dedup_repeated_category_labels(self):
        result = build({"categoryLabels": ["Crops", "Crops"]})
        assert result == ["Crops"]

    def test_non_string_category_label_coerced(self):
        # Defensive: a malformed client sending a non-string non-list value
        # should not raise TypeError; it gets stringified.
        result = build({"categoryLabel": 123})
        assert result == ["123"]
