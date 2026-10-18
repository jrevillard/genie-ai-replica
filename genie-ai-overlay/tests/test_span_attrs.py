# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the shared span attribute vocabulary and its two-layer guard.

Layer 1 (positive): every attribute key must be in ATTRIBUTE_NAMES.values().
Without it, a new attribute carrying query text is one line away and invisible.

Layer 2 (shape): any string value with whitespace, or longer than 96 characters,
is a violation. Layer 2 alone is NOT sufficient — a one-word user query has no
whitespace and passes — which is exactly why layer 1 exists.
"""

import ast
import json
import pathlib
import re

import pytest

import core.span_attrs
from core.span_attrs import (
    ATTRIBUTE_NAMES,
    EVAL_HARNESS_KEYS,
    JSON_ENCODED_ATTRIBUTE_NAMES,
    LEGACY_ATTRIBUTE_NAMES,
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
    "chatqna.query_condense",
    "chatqna.reranker_selection",
    "chatqna.stream_outcome",
    "retriever.check_health",
    "retriever.hybrid_search",
    "retriever.initialize_client",
    "retriever.initialize_llm",
    "reranker.rerank",
    "reranker.tei_invoke",
    "dataprep.chunking",
    "dataprep.ensure_vector_index",
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

    def test_vocabulary_has_eighty_entries(self):
        assert len(ATTRIBUTE_NAMES) == 80


class TestLegacyAttributeNames:
    """The legacy register keeps the sweep green without weakening it."""

    def test_sets_are_disjoint(self):
        """A name in both would be a dead key in the destination vocabulary."""
        overlap = set(ATTRIBUTE_NAMES.values()) & set(LEGACY_ATTRIBUTE_NAMES)
        assert overlap == set()

    def test_every_entry_states_why_it_is_legacy(self):
        """An entry must record WHAT IT IS, not a task that may not exist.

        The register previously attributed every key to the task that seemed to
        supersede it. Auditing each write site against the plan found NO task
        removes any of them — so an entry claiming a retiring task would be a
        lie that satisfies a pattern-matching test. Every value now states the
        real reason instead, and must say why.
        """
        for key, reason in LEGACY_ATTRIBUTE_NAMES.items():
            assert reason.startswith("legacy: "), f"{key}: {reason!r}"
            assert len(reason) > len("legacy: "), f"{key} states no reason"

    def test_no_entry_claims_a_task_that_does_not_exist(self):
        """A bare 'task N' attribution is exactly the defect being removed."""
        for key, reason in LEGACY_ATTRIBUTE_NAMES.items():
            assert not re.search(r"\btask \d+\b", reason), f"{key} still claims a task"

    def test_every_reason_comes_from_the_allowed_set(self):
        """A free-text reason is unfalsifiable; a closed set is checkable.

        The prefix check alone let three false claims through: "legacy: eval-
        harness contract" is a plausible-sounding sentence, and three of the
        five keys carrying it are read by no harness at all. Requiring
        membership in ``LEGACY_REASONS`` is what makes a novel reason a
        deliberate decision rather than an unreviewed sentence.
        """
        for key, reason in LEGACY_ATTRIBUTE_NAMES.items():
            assert reason in LEGACY_REASONS, f"{key}: {reason!r} is not an allowed reason"

    def test_the_allowed_reason_set_has_no_unused_entries(self):
        """The mirror check — otherwise the vocabulary rots into "any string passes"."""
        assert LEGACY_REASONS - set(LEGACY_ATTRIBUTE_NAMES.values()) == set()

    def test_only_the_two_keys_the_harness_reads_claim_the_harness_contract(self):
        """The false claim, pinned so it cannot come back.

        ``tests/rag-benchmarks/eval/run_eval.py`` reads exactly two of the five
        chatqna selection keys. ``rag.selected_scores``, ``rag.candidate_count``
        and ``rag.selected_count`` are written by chatqna and read nowhere else.
        """
        claimed = {k for k, r in LEGACY_ATTRIBUTE_NAMES.items() if r == "legacy: eval-harness contract"}
        assert claimed == EVAL_HARNESS_KEYS

    def test_the_harness_really_reads_exactly_those_keys(self):
        """Re-derive the harness contract from the harness source, not from us."""
        source = (
            pathlib.Path(__file__).resolve().parents[2] / "tests" / "rag-benchmarks" / "eval" / "run_eval.py"
        ).read_text()
        read_in_harness = {key for key in LEGACY_ATTRIBUTE_NAMES if key.startswith("rag.") and f'"{key}"' in source}
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

    def test_legacy_keys_are_accepted(self):
        assert free_text_violations({"rag.search_mode": "hybrid"}) == []

    def test_every_legacy_name_is_accepted(self):
        assert free_text_violations({name: "x" for name in LEGACY_ATTRIBUTE_NAMES}) == []

    def test_shape_check_still_applies_to_legacy_keys(self):
        """Registration relaxes the key layer only, never the value layer."""
        assert free_text_violations({"rag.top_k": "not a number"})
        assert free_text_violations({"reranker.model_id": "granite 4.1 8b"})

    def test_a_still_unregistered_key_is_still_caught(self):
        """The whole point: the backlog did not open the door."""
        assert free_text_violations({"rag.sniffed_query": "banana"}) == [
            "rag.sniffed_query: unregistered attribute key"
        ]

    def test_registering_the_backlog_did_not_inflate_the_vocabulary(self):
        assert len(ATTRIBUTE_NAMES) == 80
        assert len(LEGACY_ATTRIBUTE_NAMES) == 21


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

    def test_disjoint_from_the_legacy_set(self):
        assert set(JSON_ENCODED_ATTRIBUTE_NAMES) & set(LEGACY_ATTRIBUTE_NAMES) == set()

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


# The four ways this project opens a span with an explicit name.
SPAN_OPENERS = frozenset({"start_span", "start_as_current_span", "background_span", "with_span"})

# ``tracing.py`` is where those openers are DEFINED, so its own calls into
# ``tracer.start_span(name)`` pass the parameter by design. Scanning it for
# non-literal openers would report every definition as a violation.
SPAN_OPENER_DEFINITIONS = frozenset({"tracing.py"})


def overlay_root():
    return pathlib.Path(__file__).resolve().parent.parent


def _span_calls(path):
    """Yield ``(lineno, first_arg_node_or_None)`` for each span opener call."""
    import ast

    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        # A file the running interpreter cannot parse is not evidence about
        # span coverage; reporting it as an unpinned/unswept module would
        # bury the real message under a traceback.
        return
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
        if name in SPAN_OPENERS:
            yield node.lineno, (node.args[0] if node.args else None)


def _emitted_span_names(overlay_sources):
    """Every span name the overlay opens with a plain string literal.

    Derived from the sources rather than hand-listed, because a hand-maintained
    list goes stale silently — that is the defect the previous dataprep pin
    existed to have caught, and re-introducing it in a new shape would be worse
    than the drift.

    Parsed with :mod:`ast`, not matched as text. A regex over the raw source
    reads a ``with_span("llm.invoke")`` inside a DOCSTRING as a real span, and
    the guard would then demand that a documentation example be registered as
    production telemetry. (It did exactly that: ``service.operation``, the
    usage example in ``tracing.with_span``, needed a hand-written exclusion
    list to stay out.) ``ast`` sees only calls that are calls.

    FastAPI auto-instrumentation is absent by construction — those spans are
    named by the framework, not by us.
    """
    emitted = set()
    for path in overlay_sources:
        for _lineno, first in _span_calls(path):
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                emitted.add(first.value)
    return emitted


def _non_literal_span_openers(overlay_sources):
    """Span openers whose first argument is not a plain string literal.

    Reported as ``file:line`` so the remedy is obvious: pass the name as a
    literal, or the span is invisible to ``_emitted_span_names`` and therefore
    unguarded without anything failing.
    """
    offenders = []
    for path in overlay_sources:
        if path.name in SPAN_OPENER_DEFINITIONS:
            continue
        for lineno, first in _span_calls(path):
            if first is None or not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
                offenders.append(f"{path.relative_to(overlay_root())}:{lineno}")
    return offenders


class TestOwnedSpanCoverage:
    """Every span the project opens must be swept, with none opted out.

    An unswept span is one where a newly added leak is invisible. The invariant
    is deliberately "all of them" rather than a curated subset: a subset needs a
    judgement call every time a span is added, and the call that matters — "is
    this one safe?" — is exactly the one a swept span makes unnecessary.
    """

    def test_every_emitted_span_is_swept(self, owned_span_names, overlay_sources):
        """The guard against the drift this whole mechanism exists to prevent.

        Written as a subset assertion, not equality: the failure mode is a span
        nobody swept, and a span swept that emits nothing is harmless. Equality
        would also make the test fail for the wrong reason when a service is
        removed.
        """
        unswept = sorted(_emitted_span_names(overlay_sources) - set(owned_span_names))
        assert not unswept, (
            f"spans opened but never swept: {unswept}. A span missing from "
            "tests/conftest.py OWNED_SPAN_NAMES starts unguarded — any attribute "
            "it records is unchecked. Add the name, and register any attribute key "
            "it writes in core/span_attrs.py ATTRIBUTE_NAMES."
        )

    def test_the_swept_list_holds_no_span_the_code_does_not_emit(self, owned_span_names, overlay_sources):
        """The mirror failure: a name swept for a span that no longer exists.

        Harmless to the sweep itself, but it hides a rename — the span moved and
        the list kept the old name, and the new one is unguarded.
        """
        stale = sorted(set(owned_span_names) - _emitted_span_names(overlay_sources))
        assert not stale, f"OWNED_SPAN_NAMES lists spans no module opens: {stale}"

    def test_no_span_is_opened_with_a_non_literal_name(self, overlay_sources):
        """A span whose name is computed is invisible to the guard that owns it.

        ``test_every_emitted_span_is_swept`` reads span names out of the source,
        so it can only see literals. ``with_span(SPAN_NAME)`` or an f-string
        would produce a span that is BOTH unswept and unseeable — the autouse
        fixture skips it (absent from ``OWNED_SPAN_NAMES``) and the derivation
        never reports it. Nothing else in the suite would fail.

        So a non-literal opener is itself the finding: pass the name as a
        literal, or the span is unguarded by construction.
        """
        offenders = _non_literal_span_openers(overlay_sources)
        assert not offenders, (
            f"span opened with a non-literal name: {offenders}. The coverage "
            "derivation reads names from the source, so such a span is neither "
            "swept nor reported. Pass the name as a plain string literal."
        )

    def test_mirror_matches_conftest(self, owned_span_names):
        """A conftest that drops a span must fail here, not just silently."""
        assert set(owned_span_names) == OWNED_SPAN_NAMES

    def test_orchestrate_bites(self, span_sweep, captured_spans, span_exporter):
        """The primary RAG span, and the one carrying the blend and prompt-budget attributes."""
        _emit("chatqna.orchestrate", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError):
            span_sweep(captured_spans())
        span_exporter.clear()

    def test_orchestrate_accepts_its_vocabulary_keys(self, span_sweep, captured_spans):
        _emit("chatqna.orchestrate", {"rag.query_length": 42, "rag.model_id": "granite-4.1-8b"})
        assert span_sweep(captured_spans()) is None

    def test_a_dataprep_span_bites(self, span_sweep, captured_spans, span_exporter):
        """Dataprep was swept in a follow-up to issue 1090; prove the sweep reaches it.

        The upload payload is the one attribute source in the pipeline that is
        not internally constrained, so this is the case where the guard is worth
        the most — and the one that was missing.
        """
        _emit("dataprep.ingest", {"dataprep.sniffed_filename": "bean.pdf"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "dataprep.ingest" in str(excinfo.value)
        span_exporter.clear()

    def test_dataprep_accepts_its_vocabulary_keys(self, span_sweep, captured_spans):
        _emit("dataprep.llm.label_batch", {"dataprep.llm_batched": True, "dataprep.llm_batch_size": 4})
        assert span_sweep(captured_spans()) is None

    def test_prose_from_an_upload_payload_fails_a_dataprep_span(self, span_sweep, captured_spans, span_exporter):
        """The case the sweep DOES close, on the attribute with no upstream constraint.

        ``dataprep.file_id`` is read off the request body with nothing upstream
        constraining it. A client posting a human-readable id WITH SPACES puts
        that text on a span and — with no collector-side redaction on the traces
        pipeline — into VictoriaTraces for the retention window.

        SCOPE, stated so the next reader does not over-trust this: the shape rule
        is whitespace-or-length, so an id written with separators instead of
        spaces (``Contrat_de_Jean_Dupont_Q3.pdf``) passes both layers and still
        lands. Closing that means constraining the value at the write site —
        validating ``DocRepoIngestPayload.fileId`` or recording a digest — which
        is a change to the ingest API's contract, not a vocabulary decision.
        It is tracked on issue #1093 rather than done here.
        """
        _emit("dataprep.ingest", {"dataprep.file_id": "Facture de Jean Dupont"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        assert "free-text value" in str(excinfo.value)
        span_exporter.clear()

    def test_the_shape_rule_does_not_constrain_an_unvalidated_payload_value(self):
        """Pins the residual above so it cannot be quietly forgotten.

        A test asserting what the guard DOES NOT catch is unusual, and that is
        the point: without it the neighbouring test reads as a complete answer
        to "can a client put PII on a dataprep span?", and it is a partial one.
        If a future change constrains ``file_id`` at the write site, this test
        fails and the docstring above should be rewritten with it.
        """
        assert free_text_violations({"dataprep.file_id": "Contrat_de_Jean_Dupont_Q3.pdf"}) == []

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
            "test_a_dataprep_span_bites",
            "test_orchestrate_bites",
            "test_prose_from_an_upload_payload_fails_a_dataprep_span",
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
