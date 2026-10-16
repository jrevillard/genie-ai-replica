# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the shared span attribute vocabulary and its two-layer guard.

Layer 1 (positive): every attribute key must be in ATTRIBUTE_NAMES.values().
Without it, a new attribute carrying query text is one line away and invisible.

Layer 2 (shape): any string value with whitespace, or longer than 96 characters,
is a violation. Layer 2 alone is NOT sufficient — a one-word user query has no
whitespace and passes — which is exactly why layer 1 exists.
"""

import json
import re

import pytest

from core.span_attrs import (
    ATTRIBUTE_NAMES,
    DEPRECATED_ATTRIBUTE_NAMES,
    JSON_ENCODED_ATTRIBUTE_NAMES,
    MAX_STRING_LEN,
    QUERY_ID_KEY,
    UNRESOLVED,
    assert_no_free_text,
    free_text_violations,
    label_digest,
)

VOCABULARY = sorted(ATTRIBUTE_NAMES.values())

# Mirrors tests/conftest.py OWNED_SPAN_NAMES. Duplicated rather than imported so
# a conftest that drops a span name fails a test here too.
OWNED_SPAN_NAMES = {
    "llm.invoke",
    "chatqna.orchestrate",
    "chatqna.reranker_selection",
    "chatqna.stream_outcome",
    "retriever.hybrid_search",
    "reranker.rerank",
    "reranker.tei_invoke",
}


class TestLabelDigest:
    def test_digest_is_eight_lowercase_hex_chars(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest("Onion"))

    def test_digest_is_deterministic(self):
        assert label_digest("Onion") == label_digest("Onion")

    def test_digest_differs_per_label(self):
        assert label_digest("Onion") != label_digest("Vegetables")

    def test_digest_handles_multi_word_labels(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest("Soil Management"))

    def test_digest_of_empty_string_is_stable(self):
        assert re.fullmatch(r"[0-9a-f]{8}", label_digest(""))


class TestLayerTwoValueShape:
    def test_numbers_and_booleans_pass(self):
        assert_no_free_text({"rag.fetch_k": 3, "rag.hybrid.enabled": True})

    def test_opaque_id_passes(self):
        assert_no_free_text({QUERY_ID_KEY: "12345678"})

    def test_path_value_passes(self):
        assert_no_free_text({"llm.service_path": "/v1/chatqna"})

    def test_list_of_numbers_passes(self):
        assert_no_free_text({"rag.scores.dense": [0.9, 0.5, 0.1]})

    def test_list_of_digests_passes(self):
        assert_no_free_text({"rag.filter_label_digests": ["a1b2c3d4", "e5f6a7b8"]})

    def test_string_with_space_is_a_violation(self):
        (violation,) = free_text_violations({"rag.search_type": "Soil Management"})
        assert violation == "rag.search_type: free-text value 'Soil Management'"

    def test_newline_is_a_violation(self):
        assert free_text_violations({"rag.search_type": "line1\nline2"})

    def test_long_string_is_a_violation(self):
        assert free_text_violations({"rag.search_type": "x" * (MAX_STRING_LEN + 1)})

    def test_boundary_length_passes(self):
        assert free_text_violations({"rag.search_type": "x" * MAX_STRING_LEN}) == []

    def test_none_passes(self):
        assert free_text_violations({"rag.prompt.answer_budget_tokens": None}) == []


class TestLayerOneKeyVocabulary:
    def test_unregistered_key_is_a_violation(self):
        violations = free_text_violations({"rag.sniffed_query": "anything"})
        assert violations == ["rag.sniffed_query: unregistered attribute key"]

    def test_unregistered_key_is_caught_even_without_prose_shape(self):
        """The one-word query that defeats the shape rule."""
        assert free_text_violations({"rag.sniffed_query": "banana"}) != []

    def test_registered_key_with_short_value_passes(self):
        assert_no_free_text({"rag.search_type": "mmr"})

    def test_every_vocabulary_name_is_accepted(self):
        assert free_text_violations({name: "x" for name in VOCABULARY}) == []

    def test_violation_names_the_key(self):
        (violation,) = free_text_violations({"llm.model": "granite 4.1 8b"})
        assert violation.startswith("llm.model:")


class TestVocabularyShape:
    def test_query_id_key(self):
        assert QUERY_ID_KEY == "genie.query_id"

    def test_unresolved_token_has_no_whitespace(self):
        assert UNRESOLVED == "__unresolved__"

    @pytest.mark.parametrize("name", VOCABULARY)
    def test_names_are_dotted_lowercase(self, name):
        assert re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z0-9_]+)+", name)

    @pytest.mark.parametrize("name", VOCABULARY)
    def test_names_have_no_whitespace(self, name):
        assert not re.search(r"\s", name)

    def test_values_are_unique(self):
        assert len(set(VOCABULARY)) == len(VOCABULARY)

    def test_vocabulary_has_fifty_two_entries(self):
        assert len(ATTRIBUTE_NAMES) == 52


class TestDeprecatedAttributeNames:
    """The deprecation register keeps the sweep green without weakening it."""

    def test_sets_are_disjoint(self):
        """A name in both would be a dead key in the destination vocabulary."""
        overlap = set(ATTRIBUTE_NAMES.values()) & set(DEPRECATED_ATTRIBUTE_NAMES)
        assert overlap == set()

    def test_every_entry_names_the_task_that_removes_it(self):
        """An entry without an owner is a permanent addition in disguise."""
        for key, owner in DEPRECATED_ATTRIBUTE_NAMES.items():
            assert re.fullmatch(r"task \d+", owner), f"{key} has no task owner"

    def test_deprecated_keys_are_accepted(self):
        assert free_text_violations({"rag.search_mode": "hybrid"}) == []

    def test_every_deprecated_name_is_accepted(self):
        assert free_text_violations({name: "x" for name in DEPRECATED_ATTRIBUTE_NAMES}) == []

    def test_shape_check_still_applies_to_deprecated_keys(self):
        """Registration relaxes the key layer only, never the value layer."""
        assert free_text_violations({"rag.top_k": "not a number"})
        assert free_text_violations({"reranker.model_id": "granite 4.1 8b"})

    def test_a_still_unregistered_key_is_still_caught(self):
        """The whole point: the backlog did not open the door."""
        assert free_text_violations({"rag.sniffed_query": "banana"}) == [
            "rag.sniffed_query: unregistered attribute key"
        ]

    def test_registering_the_backlog_did_not_inflate_the_vocabulary(self):
        assert len(ATTRIBUTE_NAMES) == 52
        assert len(DEPRECATED_ATTRIBUTE_NAMES) == 21


class TestBytesValues:
    """Bytes must not be the one way past the shape rule."""

    def test_prose_bytes_are_a_violation(self):
        assert free_text_violations({"rag.fetch_k": b"some prose here"})

    def test_whitespace_free_bytes_pass(self):
        assert free_text_violations({"rag.fetch_k": b"mmr"}) == []

    def test_overlong_bytes_are_a_violation(self):
        assert free_text_violations({"rag.fetch_k": b"x" * (MAX_STRING_LEN + 1)})

    def test_bytearray_is_covered_too(self):
        assert free_text_violations({"rag.fetch_k": bytearray(b"some prose here")})

    def test_undecodable_bytes_do_not_crash(self):
        """errors='replace' — an invalid byte must not raise."""
        assert free_text_violations({"rag.fetch_k": b"\xff\xfe some prose"}) is not None


class TestJsonEncodedAttributeNames:
    """A declared category validated by PARSING — strictly stronger than exempt.

    OTel accepts primitives or homogeneous sequences only, so a list of dicts
    genuinely cannot go on a span except JSON-encoded. That makes the flat
    shape rule inapplicable, not the privacy guard.
    """

    def test_disjoint_from_the_vocabulary(self):
        assert set(JSON_ENCODED_ATTRIBUTE_NAMES) & set(ATTRIBUTE_NAMES.values()) == set()

    def test_disjoint_from_the_deprecated_set(self):
        assert set(JSON_ENCODED_ATTRIBUTE_NAMES) & set(DEPRECATED_ATTRIBUTE_NAMES) == set()

    def test_ids_and_numbers_pass(self):
        value = json.dumps([{"idx": 0, "score": 0.95, "selected": True}, {"idx": 1, "score": 0.6}])
        assert free_text_violations({"rag.adaptive_breakdown": value}) == []

    def test_doc_id_list_passes(self):
        assert free_text_violations({"retriever.summarizer.overflow_doc_ids": json.dumps(["chunkA", "chunkB"])}) == []

    def test_prose_in_a_leaf_fails(self):
        """The reason this is parsing and not exemption."""
        value = json.dumps([{"note": "the farmer said his soil was sandy"}])
        violations = free_text_violations({"rag.adaptive_breakdown": value})
        assert violations
        assert "free-text leaf in JSON value" in violations[0]

    def test_prose_fails_even_when_deeply_nested(self):
        value = json.dumps([{"a": {"b": ["still some prose here"]}}])
        assert free_text_violations({"rag.adaptive_breakdown": value})

    def test_unparseable_value_fails(self):
        (violation,) = free_text_violations({"rag.adaptive_breakdown": "not json at all"})
        assert "does not parse" in violation

    def test_prose_blob_fails_to_parse_and_is_caught(self):
        assert free_text_violations({"rag.adaptive_breakdown": "the farmer said his soil was sandy"})

    def test_overlong_leaf_fails(self):
        value = json.dumps([{"id": "x" * (MAX_STRING_LEN + 1)}])
        assert free_text_violations({"rag.adaptive_breakdown": value})

    def test_every_declared_name_is_validated(self):
        """No declared name silently escapes checking."""
        for name in JSON_ENCODED_ATTRIBUTE_NAMES:
            assert free_text_violations({name: "unparseable prose"})


def _emit(name, attributes):
    """Record one finished span through the session provider."""
    from opentelemetry import trace

    tracer = trace.get_tracer("test_span_attrs")
    with tracer.start_as_current_span(name) as span:
        for key, value in attributes.items():
            span.set_attribute(key, value)
    return span


class TestOwnedSpanCoverage:
    """Every span a later task writes to must be swept, not just the obvious ones.

    An unswept span is one where a newly added leak is invisible — which is why
    ``chatqna.orchestrate`` (tasks 4, 6, 7) and ``reranker.rerank`` are covered.
    """

    @pytest.mark.parametrize(
        "name",
        [
            "llm.invoke",
            "chatqna.orchestrate",
            "chatqna.reranker_selection",
            "chatqna.stream_outcome",
            "retriever.hybrid_search",
            "reranker.rerank",
            "reranker.tei_invoke",
        ],
    )
    def test_span_is_swept(self, name):
        assert name in OWNED_SPAN_NAMES

    def test_mirror_matches_conftest(self, owned_span_names):
        """A conftest that drops a span must fail here, not just silently."""
        assert set(owned_span_names) == OWNED_SPAN_NAMES

    @pytest.mark.parametrize(
        "name",
        ["dataprep.ingest", "dataprep.retract", "dataprep.chunking", "dataprep.kill_ingest"],
    )
    def test_dataprep_is_known_unswept(self, name):
        """Documented debt, not an oversight. See the conftest comment."""
        assert name not in OWNED_SPAN_NAMES

    def test_orchestrate_bites(self, span_sweep, captured_spans):
        """The gap that motivated round 4: tasks 4/6/7 write here."""
        _emit("chatqna.orchestrate", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError):
            span_sweep(captured_spans())

    def test_orchestrate_accepts_its_vocabulary_keys(self, span_sweep, captured_spans):
        _emit("chatqna.orchestrate", {"rag.query_length": 42, "rag.model_id": "granite-4.1-8b"})
        assert span_sweep(captured_spans()) is None


class TestOwnedSpanSweep:
    """The autouse sweep is the only enforcement point, so prove it bites.

    ``sweep_owned_spans`` runs at teardown, and a teardown failure cannot be
    asserted from inside the test that triggers it — so these exercise the
    ``assert_spans_clean`` helper the fixture delegates to, against spans that
    really went through the SDK's exporter.
    """

    def test_unregistered_key_on_an_owned_span_fails_the_sweep(self, span_sweep, captured_spans):
        _emit("llm.invoke", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "rag.sniffed_query: unregistered attribute key" in str(excinfo.value)

    def test_prose_on_a_registered_key_fails_the_sweep(self, span_sweep, captured_spans):
        _emit("llm.invoke", {"rag.search_type": "Soil Management"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "free-text value" in str(excinfo.value)

    def test_declared_attributes_on_an_owned_span_pass_the_sweep(self, span_sweep, captured_spans):
        _emit("llm.invoke", {"rag.fetch_k": 3, "rag.search_type": "mmr"})
        assert span_sweep(captured_spans()) is None

    def test_unowned_spans_are_not_swept(self, span_sweep, captured_spans):
        """FastAPI auto-instrumentation is legitimately outside the vocabulary."""
        _emit("GET /api/chat", {"http.method": "GET", "url.full": "http://x/api"})
        assert span_sweep(captured_spans()) is None

    def test_sweep_names_the_span_and_the_key(self, span_sweep, captured_spans):
        _emit("retriever.hybrid_search", {"rag.leaked_text": "x"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        message = str(excinfo.value)
        assert "retriever.hybrid_search" in message
        assert "rag.leaked_text" in message
