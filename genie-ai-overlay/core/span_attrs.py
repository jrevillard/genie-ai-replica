# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Shared span attribute vocabulary for the RAG pipeline.

Every attribute the pipeline records on a span is declared here, so a reviewer
can diff the vocabulary and a typo becomes an ``AttributeError`` rather than a
silently-absent field in VictoriaTraces.

The traces pipeline has NO collector-side redaction: ``transform/pii_redact``
runs on the logs branch of the collector config only, so whatever reaches a span
attribute reaches VictoriaTraces verbatim for the retention window. Discipline is
enforced at emission and checked mechanically, in two layers:

1. **Positive (the strong one).** Every attribute key must be a member of
   ``ATTRIBUTE_NAMES.values()``. A new attribute carrying query text is therefore
   impossible without a deliberate edit to this file, which review already reads.
   Layer 2 alone is not sufficient: a one-word user query has no whitespace and
   would pass a shape rule.
2. **Shape (the backstop).** A string value containing any whitespace character,
   or longer than ``MAX_STRING_LEN``, is a violation. There is no value
   allowlist — the one value that would have required one (taxonomy labels) is
   handled structurally, below, which is what lets layer 2 stay absolute.

Layer 1 accepts a second set, ``DEPRECATED_ATTRIBUTE_NAMES``: keys production
emits today that this work renames or removes. Those are registered so the sweep
can police existing spans without reporting the backlog as a fresh leak — see
that dict for why they are deliberately not in ``ATTRIBUTE_NAMES``. Both layers
apply to them exactly as to vocabulary keys.

**Array vs JSON.** Flat scalar sequences are emitted as ARRAYS — OTel represents
those natively, so a list of chunk keys is a real array attribute, never a
hand-stringed JSON blob. Structures OTel *cannot* represent (a list of dicts, any
non-homogeneous sequence) are JSON-encoded instead, and are declared in
``JSON_ENCODED_ATTRIBUTE_NAMES``. Those are validated by PARSING: the value must
parse, and every leaf string inside it faces the same layer-2 shape check. That is
strictly stronger than exempting them — prose smuggled into a leaf still fails,
and an unparseable blob is a defect.

Taxonomy labels are the one thing that cannot be recorded raw. The label
taxonomy is fetched from the Backend Service at runtime, so no static vocabulary
exists to validate it against, and real labels contain spaces ("Soil
Management"). They are reduced to a truncated BLAKE2s digest under a fixed salt
instead: deterministic across deployments, so an operator matches a digest
against their own taxonomy to recover the label, with no free text recorded and
nothing to maintain. Brute-forcing a digest yields only taxonomy values the
operator already holds.

Mirrored on the Node side in ``components/shared/lib/span-attrs.js``, created by
the companion Node task.
"""

import hashlib
import json
import re

# Key for the correlation id carried in OTel baggage. The value is the opaque
# ArangoDB ``queries._key`` — linkable to a user only via database admin access.
QUERY_ID_KEY = "genie.query_id"

# Longest permitted string attribute value. Ids, model names and URL paths sit
# far below this; prose does not.
MAX_STRING_LEN = 96

# Recorded when a join could not resolve. NOT "unknown" and NOT "" — both would
# satisfy the shape rule while reading like a real value.
UNRESOLVED = "__unresolved__"

_DIGEST_SALT = b"genie-ai-rag-span-v1"
_DIGEST_KEY = _DIGEST_SALT[:16]
_DIGEST_SIZE = 4  # bytes -> 8 hex characters

_ANY_WHITESPACE = re.compile(r"\s")

# The full vocabulary (52 entries), keyed by a short identifier for call sites.
# Values are the literal attribute name. NOTE: ``rag.fetch_k`` is only CONSULTED by the retriever
# under ``search_type == "mmr"``; chatqna defaults to similarity_score_threshold.
# It is recorded regardless, because a span that reported what was used rather
# than what was configured would be the same transparency failure this guards
# against — but read it as advisory outside mmr.
ATTRIBUTE_NAMES = {
    # Correlation
    "query_id": QUERY_ID_KEY,
    # LLM invoke
    "llm_model": "llm.model",
    "llm_service_path": "llm.service_path",
    "llm_stream": "llm.stream",
    "llm_req_temperature": "llm.request.temperature",
    "llm_req_top_p": "llm.request.top_p",
    "llm_req_max_tokens": "llm.request.max_tokens",
    "llm_req_frequency_penalty": "llm.request.frequency_penalty",
    "llm_req_repetition_penalty": "llm.request.repetition_penalty",
    "llm_usage_prompt_tokens": "llm.usage.prompt_tokens",
    "llm_usage_completion_tokens": "llm.usage.completion_tokens",
    "llm_usage_total_tokens": "llm.usage.total_tokens",
    "llm_finish_reason": "llm.finish_reason",
    "llm_stream_options_include_usage": "llm.stream_options.include_usage",
    # Retriever
    "rag_search_type": "rag.search_type",
    "rag_fetch_k": "rag.fetch_k",
    "rag_search_start_base": "rag.search_start_base",
    "rag_filter_labels_enabled": "rag.filter_labels_enabled",
    "rag_filter_label_count": "rag.filter_label_count",
    "rag_filter_label_digests": "rag.filter_label_digests",
    "rag_hybrid_enabled": "rag.hybrid.enabled",
    "rag_hybrid_dense_weight": "rag.hybrid.dense_weight",
    "rag_hybrid_lexical_weight": "rag.hybrid.lexical_weight",
    "rag_hybrid_rrf_k": "rag.hybrid.rrf_k",
    "rag_candidate_keys": "rag.candidate_keys",
    "rag_scores_dense": "rag.scores.dense",
    "rag_scores_dense_present": "rag.scores.dense_present",
    "rag_scores_bm25": "rag.scores.bm25",
    "rag_scores_fused": "rag.scores.fused",
    "rag_scores_capped": "rag.scores.capped",
    "traversal_enabled": "traversal.enabled",
    "traversal_max_depth": "traversal.max_depth",
    "traversal_max_returned": "traversal.max_returned",
    "traversal_score_threshold": "traversal.score_threshold",
    "traversal_injected_docs": "traversal.injected_docs",
    "traversal_injected_neighbor_items": "traversal.injected_neighbor_items",
    # chatqna orchestrate
    "rag_blend_enabled": "rag.blend.enabled",
    "rag_blend_alpha": "rag.blend.alpha",
    "rag_blend_history_turns": "rag.blend.history_turns",
    "rag_history_segments_in": "rag.history.segments_in",
    "rag_history_segments_sent": "rag.history.segments_sent",
    "rag_prompt_window_tokens": "rag.prompt.window_tokens",
    "rag_prompt_answer_budget_tokens": "rag.prompt.answer_budget_tokens",
    "rag_prompt_tokens_estimate": "rag.prompt.tokens_estimate",
    # Stream outcome
    "retrieval_confidence": "retrieval.confidence",
    "llm_self_confidence": "llm.self_confidence",
    "answer_is_grounded": "answer.is_grounded",
    "answer_sentinel_present": "answer.sentinel_present",
    "answer_abstained": "answer.abstained",
    # Reranker adaptive
    "rag_adaptive_chunk_keys": "rag.adaptive_chunk_keys",
    # chatqna.orchestrate — emitted today at genieai_chatqna.py:2807-2808 and
    # SURVIVING this work: task 4 adds blend/history/prompt-budget attributes
    # beside these writes rather than replacing them, so they are destination
    # vocabulary, not backlog.
    "rag_query_length": "rag.query_length",
    "rag_model_id": "rag.model_id",
}

# Attributes EMITTED TODAY by production code that are NOT in the destination
# vocabulary, registered so the per-test sweep can police EXISTING spans.
# Without them the sweep reports ~100 teardown errors, and a guard that is
# permanently red is a guard nobody reads.
#
# Why not fold them into ATTRIBUTE_NAMES: this set is the honest record of what
# production emits today, kept separate from what the plan publishes as the
# destination. Collapsing the two would hide the difference between "this is the
# vocabulary" and "this is what we inherited".
#
# **AUDITED — every entry below survives this plan.** An earlier revision
# attributed each key to the task that seemed to supersede it; auditing every
# write site against the plan showed NO task in this plan removes any of them.
# The relevant tasks all ADD attributes beside these writes rather than replacing
# them — the plan is explicit for the reranker: "adds a parallel array rather
# than reshaping the shipped attribute, because the eval harness already keys on
# it" — and two selection keys are that harness contract. They are therefore
# legacy, not pending-deletion, and each entry records what it is rather than a
# task that does not exist.
#
# What this set does NOT do is relax the privacy guard: a registered legacy key is
# still subject to the full layer-2 shape check, so prose on any of these is still
# a violation.
DEPRECATED_ATTRIBUTE_NAMES = {
    # chatqna.reranker_selection — genieai_chatqna.py:114-118. Task 6 adds
    # rag.adaptive_chunk_keys as a PARALLEL array and explicitly does not reshape
    # these; the eval harness keys on rag.selected_chunk_keys.
    "rag.candidate_chunk_keys": "legacy: eval-harness contract",
    "rag.selected_chunk_keys": "legacy: eval-harness contract",
    "rag.selected_scores": "legacy: eval-harness contract",
    "rag.candidate_count": "legacy: eval-harness contract",
    "rag.selected_count": "legacy: eval-harness contract",
    # retriever.hybrid_search — genieai_retriever_arangodb.py:878-879. Task 5 adds
    # rag.search_type / rag.fetch_k beside these; it never deletes lines 878-879.
    "rag.search_mode": "legacy: superseded in meaning, not in emission",
    "rag.top_k": "legacy: superseded in meaning, not in emission",
    # rag.chunk_count is written on BOTH retriever.hybrid_search
    # (:1428) and chatqna.orchestrate (genieai_chatqna.py:2870); no task touches
    # either site.
    "rag.chunk_count": "legacy: no task touches either write site",
    "retriever.summarizer.input_too_long": "legacy: no task touches the write site",
    "retriever.summarizer.overflow_count": "legacy: no task touches the write site",
    # reranker.tei_invoke — genieai_tei_reranker.py. Task 8 adds
    # rag.adaptive_chunk_keys and removes nothing.
    "reranker.strategy": "legacy: no task touches the write site",
    "reranker.top_n": "legacy: no task touches the write site",
    "reranker.model_id": "legacy: no task touches the write site",
    "reranker.input_doc_count": "legacy: no task touches the write site",
    "reranker.output_doc_count": "legacy: no task touches the write site",
    "reranker.score_threshold": "legacy: no task touches the write site",
    "reranker.input_too_long": "legacy: no task touches the write site",
    "reranker.rejected_tokens": "legacy: no task touches the write site",
    "rag.adaptive_context_decay_factor": "legacy: no task touches the write site",
    "rag.adaptive_min_value_threshold": "legacy: no task touches the write site",
    # chatqna.orchestrate — genieai_chatqna.py:2891. Nothing removes this write;
    # the abstention flag added on a DIFFERENT span (chatqna.stream_outcome) is
    # additive. The two coexist: a per-request reason here, a per-response flag
    # there.
    "abstained.reason": "legacy: survives — another task adds a flag on a different span, it does not remove this",
}

# Attributes whose value is a STRUCTURE OTel cannot represent natively (a list of
# dicts, or any non-homogeneous sequence). OTel attribute values are primitives
# or homogeneous sequences only, so these MUST be JSON-encoded — emitting the raw
# list would be rejected by the SDK or silently mangled.
#
# This is a declared category with real validation, NOT an exemption:
# ``free_text_violations`` parses the value and applies the layer-2 shape rule to
# every leaf string inside it. An unparseable blob fails, and prose smuggled into
# a leaf still fails.
#
# Distinct from ``ATTRIBUTE_NAMES``: the vocabulary's own ``rag.candidate_keys`` /
# ``rag.selected_chunk_keys`` / task 8's ``rag.adaptive_chunk_keys`` are FLAT lists
# of scalars, which OTel represents natively, so they are emitted as real arrays,
# not JSON. Only genuinely unrepresentable structures belong here.
JSON_ENCODED_ATTRIBUTE_NAMES = {
    "rag.adaptive_breakdown",  # reranker: list of per-chunk decision records
    "retriever.summarizer.overflow_doc_ids",  # retriever: list of overflow doc ids
}


def label_digest(label: str) -> str:
    """Return the 8-hex-char stable digest of one taxonomy label.

    Deterministic across processes and deployments (the salt is committed), so
    an operator can reproduce a digest from their own taxonomy. Not a security
    boundary: recovering a label requires the taxonomy, which the operator
    already holds.

    A 4-byte digest collides at roughly 65k labels sharing one salt. That limit
    is deliberate and far above the handful of labels on a single span; a wider
    digest would break the 8-hex-char shape this exists to satisfy.
    """
    return hashlib.blake2s(label.encode("utf-8"), key=_DIGEST_KEY, digest_size=_DIGEST_SIZE).hexdigest()


def _json_encoded_violations(key, value) -> list[str]:
    """Validate a JSON-encoded structure by parsing, not by flat shape.

    A value in ``JSON_ENCODED_ATTRIBUTE_NAMES`` holds a structure OTel cannot
    represent natively, so it must be JSON. Three rules, and the middle one is
    what makes this stronger than an exemption:

    1. It must parse. An unparseable blob in this category is a defect — and
       prose essentially never parses as JSON.
    2. Every leaf string inside the parsed structure is subject to the ordinary
       layer-2 shape check. ``{"note": "the farmer said his soil was sandy"}``
       fails exactly as it would if written flat.
    3. The container's own separators (``, ``, ``, ``: ``, braces) are not prose
       and are deliberately exempt — that is the whole reason for the category.
    """
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return [f"{key}: JSON-encoded value does not parse"]

    violations = []
    for text in _string_values(parsed):
        if _ANY_WHITESPACE.search(text) or len(text) > MAX_STRING_LEN:
            violations.append(f"{key}: free-text leaf in JSON value {text!r}")
    return violations


def _string_values(value):
    """Yield every string reachable in an attribute value.

    Sets and dict keys are traversed too. OTel only accepts homogeneous sequences
    as attribute values, so a set never reaches VictoriaTraces — but "the SDK
    would have dropped it anyway" is not a reason to accept prose silently.

    Bytes are decoded rather than skipped: the SDK would reject them too, and a
    value smuggled through as bytes must not be the one way past the shape rule.
    """
    if isinstance(value, str):
        yield value
    elif isinstance(value, (bytes, bytearray)):
        yield value.decode("utf-8", errors="replace")
    elif isinstance(value, (list, tuple, set, frozenset)):
        for item in value:
            yield from _string_values(item)
    elif isinstance(value, dict):
        for item in value:
            yield from _string_values(item)
        for item in value.values():
            yield from _string_values(item)


def free_text_violations(attributes: dict) -> list[str]:
    """Return one entry per attribute that leaks, either by key or by shape.

    Layer 1: an unregistered key is a leak by definition — it means something
    wrote to a span without declaring what it was. A key is registered if it is
    in EITHER ``ATTRIBUTE_NAMES`` (destination vocabulary) or
    ``DEPRECATED_ATTRIBUTE_NAMES`` (emitted today, being renamed). Registering a
    deprecated key relaxes nothing about its VALUE — layer 2 applies identically
    to both sets, so prose on a deprecated key is still caught.

    Layer 2: a string value with whitespace, or longer than MAX_STRING_LEN, is
    prose. Shape-based on purpose: a denylist of forbidden substrings rots and is
    defeated by wording nobody anticipated, whereas whitespace and length are
    properties no phrasing avoids.
    """
    registered = set(ATTRIBUTE_NAMES.values()) | set(DEPRECATED_ATTRIBUTE_NAMES)
    violations = []
    for key, value in (attributes or {}).items():
        if key in JSON_ENCODED_ATTRIBUTE_NAMES:
            violations.extend(_json_encoded_violations(key, value))
            continue
        if key not in registered:
            violations.append(f"{key}: unregistered attribute key")
            continue
        for text in _string_values(value):
            if _ANY_WHITESPACE.search(text) or len(text) > MAX_STRING_LEN:
                violations.append(f"{key}: free-text value {text!r}")
    return violations


def assert_no_free_text(attributes: dict) -> None:
    """Raise ``AssertionError`` naming every leaking attribute."""
    violations = free_text_violations(attributes)
    if violations:
        raise AssertionError(f"Span attribute leak (no collector-side redaction on the traces pipeline): {violations}")
