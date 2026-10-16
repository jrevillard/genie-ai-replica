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

Taxonomy labels are the one thing that cannot be recorded raw. The label
taxonomy is fetched from the Backend Service at runtime, so no static vocabulary
exists to validate it against, and real labels contain spaces ("Soil
Management"). They are reduced to a truncated BLAKE2s digest under a fixed salt
instead: deterministic across deployments, so an operator matches a digest
against their own taxonomy to recover the label, with no free text recorded and
nothing to maintain. Brute-forcing a digest yields only taxonomy values the
operator already holds.

Mirrored on the Node side in ``components/shared/lib/span-attrs.js``.
"""

import hashlib
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

# The full vocabulary, keyed by a short identifier for call sites. Values are the
# literal attribute name. NOTE: ``rag.fetch_k`` is only CONSULTED by the retriever
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
}


def label_digest(label: str) -> str:
    """Return the 8-hex-char stable digest of one taxonomy label.

    Deterministic across processes and deployments (the salt is committed), so
    an operator can reproduce a digest from their own taxonomy. Not a security
    boundary: recovering a label requires the taxonomy, which the operator
    already holds.
    """
    return hashlib.blake2s(label.encode("utf-8"), key=_DIGEST_KEY, digest_size=_DIGEST_SIZE).hexdigest()


def _string_values(value):
    """Yield every string reachable in an attribute value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _string_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _string_values(item)


def free_text_violations(attributes: dict) -> list[str]:
    """Return one entry per attribute that leaks, either by key or by shape.

    Layer 1: an unregistered key is a leak by definition — it means something
    wrote to a span without declaring what it was.

    Layer 2: a string value with whitespace, or longer than MAX_STRING_LEN, is
    prose. Shape-based on purpose: a denylist of forbidden substrings rots and is
    defeated by wording nobody anticipated, whereas whitespace and length are
    properties no phrasing avoids.
    """
    violations = []
    for key, value in (attributes or {}).items():
        if key not in ATTRIBUTE_NAMES.values():
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
