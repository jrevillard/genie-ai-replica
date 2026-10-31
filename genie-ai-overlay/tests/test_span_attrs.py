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
import functools
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
from tests.conftest import OVERLAY_ROOT

VOCABULARY = sorted(ATTRIBUTE_NAMES.values())

# Mirrors tests/conftest.py OWNED_SPAN_NAMES. Duplicated rather than imported so
# a conftest that drops a span name fails a test here too.
OWNED_SPAN_NAMES = {
    "llm.invoke",
    "chatqna.orchestrate",
    "chatqna.count_tokens",
    "chatqna.query_condense",
    "chatqna.reranker_selection",
    "chatqna.stream_outcome",
    "retriever.check_health",
    "retriever.hybrid_search",
    "retriever.route",
    "retriever.fanout",
    "retriever.fanout.leg",
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
    "dataprep.llm.phase",
    "dataprep.llm.label_chunk",
    "dataprep.log_environment_variables",
    "dataprep.recovery",
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

    def test_vocabulary_entry_count_is_pinned(self):
        # Pin on the vocabulary size. The pin exists so growth is a deliberate
        # edit rather than a drifting default, not to forbid adding a key -
        # bump this with the addition it accounts for. History: 80 -> 83 for the
        # three bounded-LLM attributes (dataprep.llm.timed_out / .timeout_seconds
        # / .phase, main); 83 -> 93 for the ten okf.fanout.* routing attributes
        # (feat/okf-server line, first registered in the 2026-10-18 rebase),
        # 93 -> 108 for the fifteen rag.route.* head-routing keys the same
        # branch writes (caught by this sweep at the 2026-10-21 merge);
        # 108 -> 109 for answer.abstention_reason (main, Query Inspector
        # !1121 - the boolean alone cannot split a spike into stale scopes vs
        # an over-rejecting reranker); 109 -> 111 for llm.endpoint +
        # token.count on the /tokenize counting span; 111 -> 112 for
        # rag.translation.query_status (issue #1026 - the query-translation
        # fallback the embedder receives).
        assert len(ATTRIBUTE_NAMES) == 112


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
        # See test_vocabulary_entry_count_is_pinned - 83 (bounded-LLM wave)
        # + 10 okf.fanout.* + 15 rag.route.* routing attributes from the okf
        # line; 108 -> 109 with answer.abstention_reason (main, !1121);
        # 109 -> 111 with the counting-span keys (llm.endpoint, token.count);
        # 111 -> 112 with rag.translation.query_status (issue #1026).
        assert len(ATTRIBUTE_NAMES) == 112
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

# Every key the sweep polices, in one place. A key is policed by whichever
# vocabulary it belongs to, so a reader that resolves a name to a key must accept
# all of them — checking only ATTRIBUTE_NAMES would miss the JSON-encoded and
# legacy registers. The two tests below assert against this instead of rebuilding
# the union, so a new vocabulary is added in one place.
#
# EVAL_HARNESS_KEYS is deliberately absent: it is a subset of LEGACY_ATTRIBUTE_NAMES
# today (test_only_the_two_keys_the_harness_reads_claim_the_harness_contract
# pins that), so including it would be redundant until the two diverge.
_REGISTERED_NAMES = (
    frozenset(ATTRIBUTE_NAMES.values()) | set(JSON_ENCODED_ATTRIBUTE_NAMES) | set(LEGACY_ATTRIBUTE_NAMES)
)


# The ways a key reaches a span. ``set_attribute`` / ``set_attributes`` are the
# SDK's own API; ``record_exception`` and the exception attributes it implies
# carry no key of ours.
_ATTRIBUTE_WRITERS = frozenset({"set_attribute", "set_attributes"})

# How deep below a writer an attribute mapping may sit before this reader stops.
# One level covers `set_attributes(sanitize_attributes({...}))`, which is how the
# condense span writes. A deeper chain means the call transforms the dict, so the
# keys that reach the span are no longer the dict's.
_MAX_MAPPING_DEPTH = 1


def _string_constant_names(module_path):
    """Names of module-level string constants, with their values.

    Used to resolve ``span.set_attribute(QUERY_ID_KEY, …)`` to the key it names,
    without a hand-kept list of which constants happen to be attributes today —
    that list would go stale exactly like the vocabulary it mirrors.
    """
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    found = {}
    for node in tree.body:
        # NAME = "..." and NAME: str = "..." are both module-level constants;
        # reading only the first silently drops the second, and a dropped
        # constant is a key the derivation stops resolving.
        if isinstance(node, ast.AnnAssign) and node.value is not None and isinstance(node.value, ast.Constant):
            if isinstance(node.target, ast.Name) and isinstance(node.value.value, str):
                found[node.target.id] = node.value.value
        elif (
            isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
        ):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    found[target.id] = node.value.value
    return found


# The overlay's shared ``tracing.py`` is where those openers are DEFINED, so its
# own calls into ``tracer.start_span(name)`` pass the parameter by design;
# scanning it for non-literal openers would report every definition as a
# violation. Matched as a full path, not a file name — a service-local
# ``retriever/tracing.py`` is a caller of these openers, not their definition,
# and opting it out by name would exempt every span opened in it from both the
# sweep and the non-literal check.
SPAN_OPENER_DEFINITIONS = frozenset({OVERLAY_ROOT / "tracing.py"})


def _span_calls(path):
    """Yield ``(lineno, first_arg_node_or_None)`` for each span opener call."""
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
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
        if path.resolve() in SPAN_OPENER_DEFINITIONS:
            continue
        for lineno, first in _span_calls(path):
            if first is None or not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
                offenders.append(f"{_display_path(path)}:{lineno}")
    return offenders


def _set_attribute_keys(overlay_sources):
    """Every span attribute key derivable from the overlay source.

    Two families of write reach a span and both are used:

    * A **literal** key — ``span.set_attribute("rag.query_length", …)``, a string
      in ``set_attributes({…})``, or a string key in an ``attributes={…}`` mapping
      on a span opener.
    * A **registered** key — ``{ATTRIBUTE_NAMES["rag_blend_alpha"]: …}``, where
      the chatqna vocabulary builders index the register rather than repeat the
      destination string, and ``A["rag_search_type"]`` in the retriever, which
      imports it under an alias (``from core.span_attrs import ATTRIBUTE_NAMES as
      A``). Both are resolved through the register here, the alias included, so
      the derived set is in destination vocabulary and compares against
      ``ATTRIBUTE_NAMES.values()`` directly. Every ``rag.prompt.*``,
      ``rag.blend.*``, ``rag.scores.*``, ``rag.hybrid.*``, ``traversal.*`` and
      ``genie.condense.*`` key reaches a span this way; a derivation that saw
      only literals would miss most of the vocabulary and claim coverage it does
      not have.

    Deriving the keys is what makes the register self-maintaining. Deriving only
    the span NAMES cannot: ``dataprep.ingest`` stays in the list whether the code
    on it writes three attributes or thirty, so a key added to a swept span is
    invisible to every check until a test happens to drive that emission site
    with a real exporter — which for most spans no test does.

    A mapping assembled at runtime carries keys no source walk can recover; those
    are reported separately as
    ``TestOwnedSpanCoverage::test_no_span_is_opened_with_a_non_literal_attribute_mapping``.
    """
    keys: set[str] = set()
    for path in overlay_sources:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        aliases = _register_aliases(tree)
        constants = _span_attrs_constants(tree)
        for node in ast.walk(tree):
            if isinstance(node, ast.Subscript):
                resolved = _registered_key(node, aliases)
                if resolved:
                    keys.add(resolved)
            elif isinstance(node, ast.Call):
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
                if name in _ATTRIBUTE_WRITERS:
                    # set_attribute("key", v) has a KEY first; set_attributes(
                    # mapping) has a MAPPING first. The two-position writer is
                    # not read through _mapping_keys: its first argument is a key,
                    # and looking for a dict inside a call that produces a key
                    # would let the walk derive a dict's contents that no writer
                    # puts on the span.
                    if node.args:
                        if name == "set_attributes":
                            keys.update(_mapping_keys(node.args[0])[0])
                            continue
                        # set_attribute's first argument is the KEY. It is read
                        # here, at the writer, and not by walking every Name in
                        # the file: `_baggage.set_baggage(QUERY_ID_KEY, v)` puts
                        # a key on a baggage entry, not on a span, and deriving
                        # it would claim coverage no span write backs.
                        key_arg = node.args[0]
                        if isinstance(key_arg, ast.Constant) and isinstance(key_arg.value, str):
                            keys.add(key_arg.value)
                        resolved = _constant_key(key_arg, constants)
                        if resolved:
                            keys.add(resolved)
                elif name in SPAN_OPENERS:
                    for keyword in node.keywords:
                        if keyword.arg in {"attributes", "attrs"}:
                            keys.update(_mapping_keys(keyword.value)[0])
    return keys


def _mapping_keys(node, depth=0):
    """``(keys, readable)`` for an expression a span attribute mapping can be.

    ``readable`` is the operative half: it is True only when every key this
    expression can put on the span is a literal this function can name. A reader
    that answers "yes, and here are the keys" for something whose keys it cannot
    enumerate is worse than one that says "I cannot see this", because the first
    silently removes a key from every downstream check.

    Four shapes, each with one reason:

    * a dict literal — every key literal, so readable. ``{}`` is readable and
      writes nothing; reporting it would be noise.
    * a dict with an unpacked entry, ``{**attrs}`` or ``{**attrs, "k": 1}`` — the
      unpacked mapping's keys are unknown and unbounded, so NOT readable even
      when the literal half is. Only the literal keys are returned, and the
      caller must treat the site as reported.
    * a call wrapping a dict, ``sanitize_attributes({...})`` — the condense span
      writes that way. One level, so the depth is bounded and a chain
      ``a(b(c({...})))`` stops being read: the further down the tree the dict
      sits, the likelier the call transforms it into something whose keys are not
      the dict's.
    * a call with several dict arguments, ``merge(base, override)`` — every
      positional argument is read, because a merge does put both mappings' keys
      on the span. Keyword arguments are NOT: ``build(meta={...})`` passes an
      unrelated dict alongside the mapping, and reading it would derive keys no
      writer emits.
    """
    if isinstance(node, ast.Dict):
        if any(key is None for key in node.keys):
            # A `None` key is `**other` — the unpacked mapping is unknown.
            return {key.value for key in node.keys if isinstance(key, ast.Constant)}, False
        return {key.value for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)}, True
    if isinstance(node, ast.Call):
        if depth >= _MAX_MAPPING_DEPTH or not node.args:
            return set(), False
        keys: set[str] = set()
        readable = True
        for arg in node.args:
            found, arg_readable = _mapping_keys(arg, depth + 1)
            keys |= found
            readable = readable and arg_readable
        return keys, readable
    return set(), False


def _register_aliases(tree):
    """Local names bound to the register in this module.

    ``from core.span_attrs import ATTRIBUTE_NAMES as A`` is how the retriever
    spells it, and the alias is a real import binding, not a local guess — so it
    is read from the import rather than guessed at each subscript.
    """
    names = {"ATTRIBUTE_NAMES"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.endswith("span_attrs"):
            for alias in node.names:
                if alias.name in {"ATTRIBUTE_NAMES", "ATTRIBUTE_NAME"} and alias.asname:
                    names.add(alias.asname)
    return names


@functools.lru_cache(maxsize=1)
def _span_attrs_string_constants():
    """The string constants ``core.span_attrs`` exports, read once per run.

    The module cannot change while the suite runs, and both walkers ask for this
    once per source file — parsing it twenty times per call was most of the
    walk's cost.
    """
    return _string_constant_names(pathlib.Path(core.span_attrs.__file__))


def _span_attrs_constants(tree):
    """Names bound to a string constant exported by ``core.span_attrs``.

    ``span.set_attribute(QUERY_ID_KEY, …)`` is the same dependency as
    ``span.set_attribute("genie.query_id", …)``, written with the constant so
    the value has one definition. The value IS a literal in the register, so a
    reader that resolves the binding gets the key without importing anything.

    Like :func:`_register_aliases`, this is read from the import rather than
    matched by name — a service is free to rename what it binds, and a reader
    keyed on the spelling ``QUERY_ID_KEY`` would silently stop resolving the day
    one does.
    """
    bound = {}
    constants = _span_attrs_string_constants()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.ImportFrom) and node.module and node.module.endswith("span_attrs")):
            continue
        for alias in node.names:
            value = constants.get(alias.name)
            # Only a constant whose VALUE is a registered attribute name can be a
            # key. `UNRESOLVED = "__unresolved__"` is the counter-example: it is
            # a value written INTO `rag.adaptive_chunk_keys`, so treating it as a
            # key would put a destination no writer produces into the derived
            # set — which is the failure mode that makes this derivation's own
            # reverse assertion fire on correct code.
            if value is not None and value in _REGISTERED_NAMES:
                bound[alias.asname or alias.name] = value
    return bound


def _constant_key(node, constants):
    """The attribute key a ``<name>`` bound to a span_attrs constant names.

    ``QUERY_ID_KEY`` is a ``genie.query_id``, written through the constant so
    the string has one definition. Reading it back needs no key registry: the
    constant's value IS the key, and it lives in the module the services import
    from.
    """
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    return None


def _registered_key(node, aliases):
    """The destination vocabulary a ``<register>["<key>"]`` subscript names."""
    if not isinstance(node, ast.Subscript):
        return None
    base = node.value
    if not (isinstance(base, ast.Name) and base.id in aliases):
        return None
    index = node.slice
    if isinstance(index, ast.Constant) and isinstance(index.value, str):
        return ATTRIBUTE_NAMES.get(index.value)
    return None


def _display_path(path):
    """A path relative to the overlay when it is inside one, absolute otherwise.

    The offenders are reported for a human to act on, and a probe file outside
    the overlay must not make the reporting helper raise — the caller is asking
    "what does this find?", not "is this under the overlay?".
    """
    try:
        return str(path.relative_to(OVERLAY_ROOT))
    except ValueError:
        return str(path)


def _non_literal_attribute_mappings(overlay_sources):
    """Write sites whose attribute keys the derivation cannot read.

    The keys inside are invisible to a source-derived check, so a mapping built
    at runtime would carry attributes that nothing polices.

    Both write forms are covered, not just the opener: ``span.set_attributes(v)``
    and ``span.set_attribute(k, v)`` hide their keys from the derivation exactly
    the way a computed ``attributes=`` does, and they are the more common of the
    two in chatqna and the retriever. Checking only the opener would leave the
    larger half of the same defect unreported.

    This is a REPORT, not a gate. Six such writes exist today — three in chatqna,
    three in the retriever — all predating the derivation. Four of the six build
    their mapping in a helper a test already asserts is free-text-free:
    ``test_no_free_text_in_prompt_budget_attributes`` and
    ``test_no_free_text_in_blend_attributes`` on the chatqna side,
    ``test_no_free_text_in_retrieval_attributes`` and
    ``test_score_attributes_pass_the_guard`` on the retriever's. The other two
    (chatqna's llm.invoke request and usage stamps) are safe structurally rather
    than by test: their keys come from a literal tuple, so the value is a number
    or a flag whatever the request carries.

    Nothing here pins that number. A count is not a contract: adding one more
    runtime-built write is ordinary work, and a test that fails on it while its
    message says the change is fine is the pin that teaches people to update pins
    without reading. The coverage threshold
    ``test_the_derivation_covers_most_registered_keys`` is what judges whether
    unreadable writes matter, because it measures the register rather than the
    sites: it names the register keys this cannot read, so a new unreadable FORM
    shows up as a coverage drop instead of passing unnoticed.
    """
    offenders = []
    for path in overlay_sources:
        if path.resolve() in SPAN_OPENER_DEFINITIONS:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        aliases = _register_aliases(tree)
        constants = _span_attrs_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if name in SPAN_OPENERS:
                for keyword in node.keywords:
                    if keyword.arg in {"attributes", "attrs"} and not _mapping_keys(keyword.value)[1]:
                        offenders.append(f"{_display_path(path)}:{node.lineno}")
            elif name in _ATTRIBUTE_WRITERS:
                # set_attribute("literal", …) is derivable; set_attribute(k, v)
                # and set_attributes(mapping) are not.
                #
                # A writer with no positional argument at all — set_attributes(**attrs)
                # — has no first argument to judge, so it is reported outright. The
                # loop form below would skip it silently, leaving a site that
                # stamps an unknown key set on a swept span reported by nobody.
                if not node.args:
                    offenders.append(f"{_display_path(path)}:{node.lineno}")
                    continue
                for arg in node.args[:1]:
                    if not _is_literal_key(arg, name, aliases, constants):
                        offenders.append(f"{_display_path(path)}:{node.lineno}")
                        break
    return offenders


def _is_literal_key(arg, writer, aliases, constants):
    """Whether an attribute-writer argument is a key the derivation can read.

    ``set_attribute(key, value)`` takes its key first; ``set_attributes(mapping)``
    takes a dict. Both are readable when they are literals — or, for the key
    argument, when it is a register subscript, which ``_set_attribute_keys``
    resolves through the same ``aliases`` this receives.

    The shared resolution is the point: ``aliases`` carries what
    ``_register_aliases`` read from the module's imports, so
    ``span.set_attribute(A["traversal.injected_docs"], …)`` is readable HERE and
    in the derivation alike. Two readers disagreeing about what is readable is
    how a report starts teaching its reader to distrust it — the alias has to be
    resolved here or not at all.
    """
    if writer == "set_attributes":
        return _mapping_keys(arg)[1]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return True
    return _constant_key(arg, constants) is not None or _registered_key(arg, aliases) is not None


def _literal_keys(node):
    """The string-literal keys of a dict literal, if that is what *node* is."""
    if not isinstance(node, ast.Dict):
        return set()
    return {key.value for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)}


class TestOwnedSpanCoverage:
    """Every span the project opens must be swept, with none opted out.

    An unswept span is one where a newly added leak is invisible. The invariant
    is deliberately "all of them" rather than a curated subset: a subset needs a
    judgement call every time a span is added, and the call that matters — "is
    this one safe?" — is exactly the one a swept span makes unnecessary.
    """

    def test_the_filter_that_hides_unregistered_constants_is_pinned(self):
        """``_span_attrs_constants`` only resolves a name the register knows.

        A constant is read as a KEY only when its value is already a registered
        attribute name. That filter is what keeps ``UNRESOLVED`` out — it is a
        value written INTO ``rag.adaptive_chunk_keys``, not a key — and it is
        also what makes a NEW unregistered constant invisible to this derivation.

        So the invisible side is named here rather than assumed. A second
        non-key constant means the resolver has a second special case nobody
        wrote down, and a reader cannot tell which shape it will refuse next.
        """
        from core.span_attrs import QUERY_TRANSLATION_STATUSES

        declared = _span_attrs_string_constants()
        not_keys = {value for value in declared.values() if value not in _REGISTERED_NAMES}
        # The query-translation status values are VALUES (written into
        # rag.translation.query_status), not keys: the vocabulary tuple is
        # imported here so the pin and the vocabulary cannot drift apart.
        assert not_keys == {UNRESOLVED, *QUERY_TRANSLATION_STATUSES}, (
            f"span_attrs string constants that are not registered attribute names: "
            f"{sorted(not_keys)}. Each is invisible to the key derivation, so a "
            "constant written as a key carries nothing the sweep can check."
        )

    def test_the_three_resolutions_are_needed_for_the_real_sources(self, overlay_sources):
        """Each of the three indirections earns its place on the overlay itself.

        Every one of them is ungated by construction if the probe alone is
        trusted. Dropping a resolution removes keys from the derived set, and
        nothing downstream complains: coverage stays above the threshold, and
        the reverse gate only fires on a key that IS written and IS unregistered
        — a key that stopped being derived cannot trip it. That is how a
        resolution can be reverted with the suite green.

        So the keys each resolution is responsible for are named here, against
        the real walk rather than a synthetic file. All three condense keys are
        asserted, not two: a partial fix must fail too.
        """
        derived = _set_attribute_keys(overlay_sources)

        assert {
            "genie.condense.mode",
            "genie.condense.status",
            "genie.condense.latency_ms",
        } <= derived, (
            "the condense keys are written one call below set_attributes; they are "
            "what reading through a wrapping call buys, and they left the derived "
            "set when that lookup stopped"
        )
        assert "genie.query_id" in derived, (
            "genie.query_id is stamped through the QUERY_ID_KEY constant on six "
            "sites. Resolving span_attrs string constants is what makes them "
            "derivable; without it all six leave the derived set at once"
        )
        assert {"traversal.injected_docs", "traversal.injected_neighbor_items"} <= derived, (
            "the retriever writes these through the import alias A[...]. Resolving "
            "the alias is what makes them derivable — hardcoding ATTRIBUTE_NAMES "
            "loses them, and the same hardcoding is what once made the report "
            "disagree with this walk"
        )

    def test_every_attribute_key_written_in_the_overlay_is_registered(self, overlay_sources):
        """A key on a swept span is still unguarded until something else checks it.

        ``test_every_emitted_span_is_swept`` reads span NAMES from the source, so
        it cannot see what a span writes: adding ``set_attribute("dataprep.
        file_name", payload.fileName)`` to ``dataprep.ingest`` leaves the name
        unchanged and the sweep green. Whether the new key is policed then rests
        on a test happening to drive that emission site with a real exporter —
        which, for most spans, none does.

        So the keys are derived too, and every one of them must be registered in
        one of the four vocabularies. The union is deliberate: a key is policed
        by whichever category it belongs to, and being absent from
        ``ATTRIBUTE_NAMES`` alone is not evidence of that.

        This asserts in one direction only — a key WRITTEN must be REGISTERED.
        The reverse (every registered key has a writer) is
        ``test_the_derivation_covers_most_registered_keys``: a register entry
        with no writer is either dead vocabulary or a write form the derivation
        cannot read, and both need a decision.
        """
        registered = set(_REGISTERED_NAMES)
        unregistered = sorted(_set_attribute_keys(overlay_sources) - registered)
        assert not unregistered, (
            f"span attributes written in the overlay but registered nowhere: {unregistered}. "
            "Register each in core/span_attrs.py — ATTRIBUTE_NAMES for a plain "
            "value, JSON_ENCODED_ATTRIBUTE_NAMES for a structure OTel cannot "
            "represent natively, EVAL_HARNESS_KEYS for a key the RAG harness "
            "reads, LEGACY_ATTRIBUTE_NAMES only for a key that already ships "
            "and cannot change."
        )

    def test_timeout_attributes_are_emitted_through_the_vocabulary(self, overlay_sources):
        """The two timeout keys must be read from the register, not retyped.

        ``test_every_attribute_key_written_in_the_overlay_is_registered`` checks
        that a written key is *registered*, not that the emitter reads the
        register. Writing ``span.set_attribute("dataprep.llm.timed_out", True)``
        passes while ``ATTRIBUTE_NAMES["dataprep_llm_timed_out"]`` is renamed:
        the vocabulary and the emitters then disagree, and the size pin above
        still passes because the vocabulary did not shrink.

        Scoped to the keys this work added rather than to dataprep's whole span
        surface: the pre-existing attributes there are written as literals and
        converting them is a separate change, not something this test should
        make a prerequisite for.
        """
        keys = {ATTRIBUTE_NAMES["dataprep_llm_timed_out"], ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"]}
        offenders: list[str] = []
        for path in overlay_sources:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "set_attribute"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and node.args[0].value in keys
                ):
                    offenders.append(f"{path.name}:{node.lineno} {node.args[0].value}")
        assert not offenders, (
            f"timeout attributes written as literals instead of read from ATTRIBUTE_NAMES: "
            f"{offenders}. Index the vocabulary so a rename propagates."
        )

    def test_the_derivation_covers_most_registered_keys(self, overlay_sources):
        """The reverse direction, which is how a coverage claim gets measured.

        Without this, a derivation can quietly see half the vocabulary and still
        pass every other assertion — the assertion above only fails on a key
        that IS written and IS unregistered, so shrinking what the walk reads
        makes it stricter-looking, not weaker, and nothing notices.

        Coverage is not expected to reach 1.00, for two reasons that are not
        defects. ``llm.request.repetition_penalty`` is registered with no writer
        by design — chatqna never sends the parameter, and two tests pin its
        absence. Seven keys reach a span through a tuple of
        ``(field, register_key)`` pairs walked by a loop variable, which a source
        walk would have to interpret rather than read: four in the module-level
        ``_LLM_REQUEST_PARAM_ATTRS`` (``llm.request.max_tokens``, ``top_p``,
        ``temperature``, ``frequency_penalty``) and three in a tuple literal
        inside ``_emit_llm_invoke_usage`` (``llm.usage.prompt_tokens``,
        ``completion_tokens``, ``total_tokens``).

        Both are named in the failure, so the unreadable set stays visible
        instead of becoming an assumption. Were a ninth and tenth key to join
        them the threshold would still pass, which is the trade: it is set low
        enough not to bite on ordinary vocabulary growth, and the reverse
        assertion above is what catches a genuine regression.
        """
        registered = set(_REGISTERED_NAMES)
        unreadable = sorted(registered - _set_attribute_keys(overlay_sources))
        covered = (len(registered) - len(unreadable)) / len(registered)
        assert covered >= 0.85, (
            f"the key derivation reads only {covered:.0%} of the {len(registered)} "
            f"registered keys. Either a write form it used to handle changed, or "
            f"vocabulary was added for keys nothing writes. Keys it cannot read: "
            f"{unreadable}."
        )

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

    def test_a_non_literal_attribute_mapping_is_reported(self, tmp_path):
        """The check that names a write form the derivation cannot read must work.

        It reports rather than gates: the six write sites that exist today all
        predate the derivation, and four of the six build their mapping in a
        helper a test already asserts is free-text-free — so making them CI
        failures would be noise dressed as rigor. The remaining two are safe by
        construction rather than by test; ``_non_literal_attribute_mappings``
        says which is which. Coverage is gated instead, by threshold, in
        ``test_the_derivation_covers_most_registered_keys``.

        So the assertion here is about the DETECTION, on a synthetic file: a
        mapping built at runtime is reported, a dict literal is not — including
        the literal one call deep, which is the shape that hid the condense keys.
        Without this the report could quietly stop reporting and nothing would
        fail.
        """
        probe = tmp_path / "probe.py"
        probe.write_text(
            "from core.span_attrs import ATTRIBUTE_NAMES as A, QUERY_ID_KEY\n"
            'with_span("a.b", attributes=build())\n'
            "span.set_attribute(variable_key, 1)\n"
            "span.set_attributes(prepared)\n"
            # Readable one call deep — the shape that hid the condense keys.
            'span.set_attributes(sanitize({"genie.condense.mode": "x"}))\n'
            # Readable through the import alias and the constant. Both were
            # reported as unreadable before, by a reader that resolved neither.
            'span.set_attribute(A["traversal_max_depth"], 1)\n'
            "span.set_attribute(QUERY_ID_KEY, qid)\n"
            # Unpacked keys are unknown, so the site is not readable even though
            # a literal sits beside them. Bounded depth: three levels deep stops.
            "span.set_attributes({**attrs})\n"
            'span.set_attributes({**attrs, "packed.literal": 1})\n'
            'span.set_attributes(a(b(c({"too.deep": 1}))))\n'
            # A keyword beside the mapping is not the mapping.
            'span.set_attributes(build(meta={"not.the.mapping": 1}))\n'
            # No positional argument at all: nothing to judge, so report it.
            "span.set_attributes(**attrs)\n"
            'with_span("c.d", attributes={"literal.key": 1})\n'
            'span.set_attribute("literal.key", 1)\n',
            encoding="utf-8",
        )
        offenders = _non_literal_attribute_mappings([probe])
        assert len(offenders) == 8, f"expected eight runtime-built writes, got {offenders}"

    def test_mirror_matches_conftest(self, owned_span_names):
        """A conftest that drops a span must fail here, not just silently."""
        assert set(owned_span_names) == OWNED_SPAN_NAMES

    def test_orchestrate_bites(self, span_sweep, captured_spans, span_exporter):
        """The primary RAG span, and the one carrying the blend and prompt-budget attributes."""
        _emit("chatqna.orchestrate", {"rag.sniffed_query": "banana"})
        with pytest.raises(AssertionError):
            span_sweep(captured_spans())

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

    def test_the_shape_rule_does_not_constrain_an_unvalidated_payload_value(self):
        """Pins the residual above so it cannot be quietly forgotten.

        A test asserting what the guard DOES NOT catch is unusual, and that is
        the point: without it the neighbouring test reads as a complete answer
        to "can a client put PII on a dataprep span?", and it is a partial one.
        If a future change constrains ``file_id`` at the write site, this test
        fails and the docstring above should be rewritten with it.
        """
        assert free_text_violations({"dataprep.file_id": "Contrat_de_Jean_Dupont_Q3.pdf"}) == []

    def test_only_deliberate_leak_tests_may_request_the_exporter(self):
        """``span_exporter`` is a hole in the sweep; keep it exactly as wide as it must be.

        Requesting the fixture clears the exporter at teardown, which is what
        lets a test emit a leak on purpose and assert the sweep bites. The cost
        is that any future test can request it and silence the sweep for itself.
        Naming a closed set of tests here is the cheapest thing that makes that a
        deliberate act: adding a fifth caller fails this test, and the reviewer
        has to look at why. A "deliberate leak" marker attribute is the wrong
        closure — the sweep's first layer rejects unregistered keys, so the
        marker would have to enter the shipped trace vocabulary.
        """
        requester = re.compile(r"def (test_\w+)\([^)]*\bspan_exporter\b")
        callers = set()
        for path in sorted(OVERLAY_ROOT.joinpath("tests").glob("test_*.py")):
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

    def test_prose_on_a_registered_key_fails_the_sweep(self, span_sweep, captured_spans, span_exporter):
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

    def test_sweep_names_the_span_and_the_key(self, span_sweep, captured_spans, span_exporter):
        _emit("retriever.hybrid_search", {"rag.leaked_text": "x"})
        with pytest.raises(AssertionError) as excinfo:
            span_sweep(captured_spans())
        message = str(excinfo.value)
        assert "retriever.hybrid_search" in message
        assert "rag.leaked_text" in message
