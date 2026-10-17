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
import pathlib
import re

import pytest

import core.span_attrs
from core.span_attrs import (
    ATTRIBUTE_NAMES,
    DEPRECATED_ATTRIBUTE_NAMES,
    EVAL_HARNESS_KEYS,
    JSON_ENCODED_ATTRIBUTE_NAMES,
    LEGACY_REASONS,
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

# Every dataprep span the code emits, pinned as KNOWN UNSWEPT (out of scope for
# issue 1090 — see the conftest comment). Derived from the source, not written by
# hand: the hand-written list was missing 8 of the 14, and a hand-maintained list
# goes stale silently. TestOwnedSpanCoverage::test_dataprep_pin_matches_the_code
# re-derives it and fails if this drifts.
#
# Several carry vocabulary-bearing attributes — dataprep.llm.label_chunk and
# dataprep.llm.context_doc record dataprep.llm_model, the latter also
# dataprep.contextual_strategy — so this is real unswept surface, not an empty
# formality.
DATAPREP_SPAN_NAMES = {
    "dataprep.chunking",
    "dataprep.ensure_vector_index",
    "dataprep.healthcheck",
    "dataprep.ingest",
    "dataprep.ingest.background",
    "dataprep.initialize_client",
    "dataprep.kill_ingest",
    "dataprep.llm.context_batch",
    "dataprep.llm.context_chunk",
    "dataprep.llm.context_doc",
    "dataprep.llm.label_batch",
    "dataprep.llm.label_chunk",
    "dataprep.log_environment_variables",
    "dataprep.retract",
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

    def test_every_entry_states_why_it_is_legacy(self):
        """An entry must record WHAT IT IS, not a task that may not exist.

        The register previously attributed every key to the task that seemed to
        supersede it. Auditing each write site against the plan found NO task
        removes any of them — so an entry claiming a retiring task would be a
        lie that satisfies a pattern-matching test. Every value now states the
        real reason instead, and must say why.
        """
        for key, reason in DEPRECATED_ATTRIBUTE_NAMES.items():
            assert reason.startswith("legacy: "), f"{key}: {reason!r}"
            assert len(reason) > len("legacy: "), f"{key} states no reason"

    def test_no_entry_claims_a_task_that_does_not_exist(self):
        """A bare 'task N' attribution is exactly the defect being removed."""
        for key, reason in DEPRECATED_ATTRIBUTE_NAMES.items():
            assert not re.search(r"\btask \d+\b", reason), f"{key} still claims a task"

    def test_every_reason_comes_from_the_allowed_set(self):
        """A free-text reason is unfalsifiable; a closed set is checkable.

        The prefix check alone let three false claims through: "legacy: eval-
        harness contract" is a plausible-sounding sentence, and three of the
        five keys carrying it are read by no harness at all. Requiring
        membership in ``LEGACY_REASONS`` is what makes a novel reason a
        deliberate decision rather than an unreviewed sentence.
        """
        for key, reason in DEPRECATED_ATTRIBUTE_NAMES.items():
            assert reason in LEGACY_REASONS, f"{key}: {reason!r} is not an allowed reason"

    def test_the_allowed_reason_set_has_no_unused_entries(self):
        """The mirror check — otherwise the vocabulary rots into "any string passes"."""
        assert LEGACY_REASONS - set(DEPRECATED_ATTRIBUTE_NAMES.values()) == set()

    def test_only_the_two_keys_the_harness_reads_claim_the_harness_contract(self):
        """The false claim, pinned so it cannot come back.

        ``tests/rag-benchmarks/eval/run_eval.py`` reads exactly two of the five
        chatqna selection keys. ``rag.selected_scores``, ``rag.candidate_count``
        and ``rag.selected_count`` are written by chatqna and read nowhere else.
        """
        claimed = {k for k, r in DEPRECATED_ATTRIBUTE_NAMES.items() if r == "legacy: eval-harness contract"}
        assert claimed == EVAL_HARNESS_KEYS

    def test_the_harness_really_reads_exactly_those_keys(self):
        """Re-derive the harness contract from the harness source, not from us."""
        source = (
            pathlib.Path(__file__).resolve().parents[2] / "tests" / "rag-benchmarks" / "eval" / "run_eval.py"
        ).read_text()
        read_in_harness = {key for key in DEPRECATED_ATTRIBUTE_NAMES if key.startswith("rag.") and f'"{key}"' in source}
        assert read_in_harness == EVAL_HARNESS_KEYS, f"harness source reads {sorted(read_in_harness)}"

    def test_no_entry_claims_a_key_will_be_renamed_or_removed(self):
        """The plan's pattern is add-beside. No key here is pending deletion.

        The old module docstring and ``free_text_violations`` docstring both
        said this set holds keys "that this work renames or removes". It does
        not, and the two selection keys it names are read by the eval harness —
        so a future author acting on that wording would delete live writes.
        """
        source = pathlib.Path(core.span_attrs.__file__).read_text()
        for phrase in ("renames or removes", "being renamed"):
            assert phrase not in source, f"span_attrs.py still claims a key is {phrase!r}"

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

    @pytest.mark.parametrize("name", sorted(DATAPREP_SPAN_NAMES))
    def test_dataprep_is_known_unswept(self, name):
        """Documented debt, not an oversight. See the conftest comment."""
        assert name not in OWNED_SPAN_NAMES

    def test_orchestrate_bites(self, span_sweep, captured_spans, span_exporter):
        """The primary RAG span, and the one carrying the blend and prompt-budget attributes."""
        _emit("chatqna.orchestrate", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError):
            span_sweep(captured_spans())
        span_exporter.clear()

    def test_orchestrate_accepts_its_vocabulary_keys(self, span_sweep, captured_spans):
        _emit("chatqna.orchestrate", {"rag.query_length": 42, "rag.model_id": "granite-4.1-8b"})
        assert span_sweep(captured_spans()) is None

    def test_dataprep_pin_matches_the_code(self, owned_span_names):
        """The pin must list every dataprep span the code actually emits.

        A hand-maintained list goes stale silently: a new dataprep span would
        start unswept with no failing test. Deriving it from the source keeps the
        pin honest.
        """
        import pathlib
        import re as _re

        root = pathlib.Path(__file__).resolve().parent.parent
        # Only names opened as spans — a bare "dataprep.*" string also appears as
        # an attribute-key prefix (dataprep.file_id), and those are not spans.
        opener = _re.compile(
            r"""(?:start_span|start_as_current_span|background_span|with_span)\(\s*["'](dataprep\.[a-z_.]+)["']"""
        )
        emitted = set()
        for path in list(root.glob("dataprep/*.py")) + [root / "tracing.py"]:
            emitted.update(opener.findall(path.read_text(encoding="utf-8", errors="replace")))
        assert emitted == set(DATAPREP_SPAN_NAMES), (
            f"dataprep pin is stale: code emits {sorted(emitted)}, pin lists {sorted(DATAPREP_SPAN_NAMES)}"
        )
        assert not (emitted & set(owned_span_names)), "a dataprep span started being swept"

    def test_only_deliberate_leak_tests_may_clear_the_exporter(self):
        """``span_exporter`` is a hole in the sweep; keep it exactly as wide as it must be.

        The autouse sweep reads the exporter at teardown. A test that emits a
        leak on purpose to prove the sweep bites must therefore clear the
        exporter itself, or it is reported twice and fails for the wrong reason
        — which trains a reader to ignore the sweep. That is the whole reason the
        fixture exists.

        The cost is that any future test CAN request it and silence the sweep for
        itself. Naming a closed set of tests here is the cheapest thing that
        makes that a deliberate act: adding a fifth caller fails this test, and
        the reviewer has to look at why. A "deliberate leak" marker attribute is
        the wrong closure — the sweep's first layer rejects unregistered keys, so
        the marker would have to enter the shipped trace vocabulary.
        """
        import pathlib
        import re as _re

        root = pathlib.Path(__file__).resolve().parent
        requester = _re.compile(r"def (test_\w+)\([^)]*\bspan_exporter\b")
        callers = set()
        for path in sorted(root.glob("test_*.py")):
            callers.update(requester.findall(path.read_text(encoding="utf-8", errors="replace")))
        expected = {
            "test_orchestrate_bites",
            "test_prose_on_a_registered_key_fails_the_sweep",
            "test_sweep_names_the_span_and_the_key",
            "test_unregistered_key_on_an_owned_span_fails_the_sweep",
        }
        assert callers == expected, (
            f"span_exporter callers changed: found {sorted(callers)}, expected {sorted(expected)}"
        )


class TestOwnedSpanSweep:
    """The autouse sweep is the only enforcement point, so prove it bites.

    ``sweep_owned_spans`` runs at teardown, and a teardown failure cannot be
    asserted from inside the test that triggers it — so these exercise the
    ``assert_spans_clean`` helper the fixture delegates to, against spans that
    really went through the SDK's exporter.
    """

    def test_unregistered_key_on_an_owned_span_fails_the_sweep(self, span_sweep, captured_spans, span_exporter):
        _emit("llm.invoke", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "rag.sniffed_query: unregistered attribute key" in str(excinfo.value)
        span_exporter.clear()

    def test_prose_on_a_registered_key_fails_the_sweep(self, span_sweep, captured_spans, span_exporter):
        _emit("llm.invoke", {"rag.search_type": "Soil Management"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "free-text value" in str(excinfo.value)
        span_exporter.clear()

    def test_declared_attributes_on_an_owned_span_pass_the_sweep(self, span_sweep, captured_spans):
        _emit("llm.invoke", {"rag.fetch_k": 3, "rag.search_type": "mmr"})
        assert span_sweep(captured_spans()) is None

    def test_unowned_spans_are_not_swept(self, span_sweep, captured_spans):
        """FastAPI auto-instrumentation is legitimately outside the vocabulary."""
        _emit("GET /api/chat", {"http.method": "GET", "url.full": "http://x/api"})
        assert span_sweep(captured_spans()) is None

    def test_sweep_names_the_span_and_the_key(self, span_sweep, captured_spans, span_exporter):
        _emit("retriever.hybrid_search", {"rag.leaked_text": "x"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        message = str(excinfo.value)
        assert "retriever.hybrid_search" in message
        assert "rag.leaked_text" in message
        span_exporter.clear()
