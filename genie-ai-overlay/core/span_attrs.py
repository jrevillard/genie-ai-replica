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

Layer 1 accepts a second set, ``LEGACY_ATTRIBUTE_NAMES``: keys production
emits today that are NOT part of the destination vocabulary. They are registered
so the sweep can police existing spans without reporting the backlog as a fresh
leak — see that dict for why they are deliberately not in ``ATTRIBUTE_NAMES``.
Both layers apply to them exactly as to vocabulary keys.

**Nothing in that set is renamed or removed by this work.** Every one of its keys
pre-dates this plan and every one survives it: the plan's pattern is to ADD
attributes BESIDE these writes, never to replace them. This matters beyond
bookkeeping — ``tests/rag-benchmarks/eval/run_eval.py`` reads
``rag.candidate_chunk_keys`` and ``rag.selected_chunk_keys``, so anyone reading
this set as a deletion backlog and removing those writes would break the
retrieval evaluation harness.

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

# The closed vocabulary of ``rag.translation.query_status`` — what the history
# translator handed the embedder on a chat turn. The one home the emitting code
# unpacks its values from; the operator runbook and the API reference document
# the same values in prose.
QUERY_TRANSLATION_STATUSES = (
    "translated",
    "passthrough_english",
    "passthrough_unknown_language",
    "fallback_timeout",
    "fallback_error",
)

# Recorded when a join could not resolve. NOT "unknown" and NOT "" — both would
# satisfy the shape rule while reading like a real value.
UNRESOLVED = "__unresolved__"

_DIGEST_SALT = b"genie-ai-rag-span-v1"
_DIGEST_KEY = _DIGEST_SALT[:16]
_DIGEST_SIZE = 4  # bytes -> 8 hex characters

_ANY_WHITESPACE = re.compile(r"\s")

# The full vocabulary (80 entries), keyed by a short identifier for call sites.
# Values are the literal attribute name.
#
# SCOPE: every span attribute the pipeline publishes, on the QUERY path
# (chatqna / retriever / reranker, keys ``rag.*`` / ``llm.*`` /
# ``retrieval.*`` / ``answer.*`` / ``traversal.*`` / ``reranker.*``) and on the
# INGEST path (dataprep, keys ``dataprep.*``). The two live in one register
# because they answer the same question — "may this value be written onto a
# span?" — and splitting them by service would mean a third register whose axis
# is the directory layout, which moves.
#
# METRIC attribute keys are NOT here: they never reach a span and are policed
# by their own path (``tracing.sanitize_attributes``). ``dataprep.call_site`` is
# the worked example.
#
# Two entries are REQUEST-derived rather than deploy-derived, and are flagged
# where they are declared:
#   * ``rag.fetch_k`` is only CONSULTED by the retriever under
#     ``search_type == "mmr"``; chatqna defaults to similarity_score_threshold.
#     It is recorded regardless, because a span that reported what was used
#     rather than what was configured would be the same transparency failure
#     this guards against — but read it as advisory outside mmr.
#   * ``rag.hybrid.enabled`` is true only when the lexical channel was engaged
#     for THAT request (deploy flag on AND a chunk search start), not when the
#     deployment has the flag on. An ``edge``/``node`` search reports false
#     because no fusion ran. Read it as "was fusion possible for this request",
#     with ``rag.search_start_base`` beside it.
ATTRIBUTE_NAMES = {
    # Correlation
    "query_id": QUERY_ID_KEY,
    # OKF multi-repo fan-out routing (feat/okf-server line). Values are
    # counts/booleans except leg.graph_name, which carries the Arango graph
    # collection name (identifier-charset, no whitespace).
    "okf_fanout_exclude_legacy": "okf.fanout.exclude_legacy",
    "okf_fanout_engaged": "okf.fanout.engaged",
    "okf_fanout_carrier_graph_count": "okf.fanout.carrier_graph_count",
    "okf_fanout_timeout_ms": "okf.fanout.timeout_ms",
    "okf_fanout_graph_count": "okf.fanout.graph_count",
    "okf_fanout_leg_graph_name": "okf.fanout.leg.graph_name",
    "okf_fanout_leg_empty_fallback": "okf.fanout.leg_empty_fallback",
    "okf_fanout_legs_succeeded": "okf.fanout.legs_succeeded",
    "okf_fanout_legs_failed": "okf.fanout.legs_failed",
    "okf_fanout_fused_count": "okf.fanout.fused_count",
    # rag.route.* — the Routing Lab's head-vector routing (feat/okf-server):
    # which graphs a query fanned out to and why. Caught unregistered by
    # main's vocabulary sweep when the branches merged (2026-10-21).
    "rag_route_mode": "rag.route.mode",
    "rag_route_applied": "rag.route.applied",
    "rag_route_selected": "rag.route.selected",
    "rag_route_probed": "rag.route.probed",
    "rag_route_search_set": "rag.route.search_set",
    "rag_route_head_weight": "rag.route.head_weight",
    "rag_route_head_rows": "rag.route.head_rows",
    "rag_route_heads_floored": "rag.route.heads_floored",
    "rag_route_heads_gated": "rag.route.heads_gated",
    "rag_route_heads_vetoed": "rag.route.heads_vetoed",
    "rag_route_failed_probes": "rag.route.failed_probes",
    "rag_route_sticky": "rag.route.sticky",
    "rag_route_wall_ms": "rag.route.wall_ms",
    "rag_route_degraded": "rag.route.degraded",
    "rag_route_dropped": "rag.route.dropped",
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
    # Request-derived, see the note above: true means fusion was ENGAGED here.
    "rag_hybrid_enabled": "rag.hybrid.enabled",
    "rag_hybrid_dense_weight": "rag.hybrid.dense_weight",
    "rag_hybrid_lexical_weight": "rag.hybrid.lexical_weight",
    "rag_hybrid_rrf_k": "rag.hybrid.rrf_k",
    "rag_candidate_keys": "rag.candidate_keys",
    # ------------------------------------------------------------------------
    # JOIN SENTINELS — two different literals, both meaning "the join failed".
    #
    # ``rag.candidate_chunk_keys`` / ``rag.selected_chunk_keys`` (see
    # LEGACY_ATTRIBUTE_NAMES) use the literal "N/A" — a pre-existing write
    # at chatqna/genieai_chatqna.py, NOT changed here: the eval harness reads
    # those arrays, and a different token would be a second way for it to see an
    # unresolved entry as a chunk key.
    # ``rag.adaptive_chunk_keys`` uses the module-level ``UNRESOLVED`` constant,
    # likewise a token rather than a key.
    #
    # An operator joining chatqna's candidate/selected chunk keys to the
    # reranker's adaptive breakdown must therefore special-case BOTH. Neither
    # satisfies the layer-2 shape rule (no whitespace, short), which is exactly
    # why they are easy to miss.
    # ------------------------------------------------------------------------
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
    # What the history translator handed the embedder: "translated",
    # "passthrough_english", "passthrough_unknown_language",
    # "fallback_timeout" or "fallback_error" — the passthrough/fallback
    # values name the request where the English corpus was queried with
    # something else.
    "rag_translation_query_status": "rag.translation.query_status",
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
    "answer_abstention_reason": "answer.abstention_reason",
    # Reranker adaptive
    "rag_adaptive_chunk_keys": "rag.adaptive_chunk_keys",
    # chatqna.orchestrate — written at genieai_chatqna.py:2807-2808. The
    # blend / history / prompt-budget attributes sit BESIDE these writes rather
    # than replacing them, so these are destination vocabulary, not backlog.
    "rag_query_length": "rag.query_length",
    "rag_model_id": "rag.model_id",
    "llm_endpoint": "llm.endpoint",
    "token_count": "token.count",
    # ------------------------------------------------------------------------
    # DATAPREP — the ingest path, swept on the same terms as the query path.
    #
    # Dataprep is the one service where a span attribute comes from an EXTERNALLY
    # SUPPLIED HTTP body rather than from internal state: ``dataprep.file_type``
    # and ``dataprep.file_id`` are read off the upload payload verbatim. Nothing
    # upstream constrains them, so a client that posts ``fileId: "Contrat de
    # Jean Dupont"`` would put that string on a span and, with no collector-side
    # redaction on the traces pipeline, into VictoriaTraces for the retention
    # window.
    #
    # Registering these keys does NOT filter that value at runtime. Nothing in
    # the services calls ``free_text_violations`` / ``assert_no_free_text`` — the
    # shape rule is exercised by the test suite, so what
    # this register buys is that a free-text value on these keys FAILS A TEST.
    # Stopping it at the write site is a separate change, to the ingest API's
    # contract (validate ``fileId`` or record a digest).
    #
    # Every other dataprep key is a count, a length, a flag, or an enum — none
    # carries document content. The five ``llm.*`` spans sit one attribute away
    # from the chunk text they are labelling, which is the other reason they are
    # swept.
    #
    # METRIC-ONLY KEYS ARE DELIBERATELY ABSENT. ``dataprep.call_site`` labels the
    # input-too-long counter and never reaches a span; listing it here would make
    # this register claim a key no span carries.
    # ------------------------------------------------------------------------
    # Ingest entry (dataprep.ingest) / retract (dataprep.retract) / kill
    "dataprep_file_type": "dataprep.file_type",
    "dataprep_file_size_bytes": "dataprep.file_size_bytes",
    "dataprep_file_id": "dataprep.file_id",
    "dataprep_kill_result": "dataprep.kill_result",
    # Chunking — dataprep.chunking and the llm.* spans that label the chunks
    "dataprep_chunk_count": "dataprep.chunk_count",
    "dataprep_chunk_index": "dataprep.chunk_index",
    "dataprep_chunk_indices": "dataprep.chunk_indices",
    # Vector index — dataprep.ensure_vector_index
    "dataprep_graph_name": "dataprep.graph_name",
    "dataprep_index_action": "dataprep.index_action",
    "dataprep_index_dim": "dataprep.index_dim",
    # Dataprep's own LLM calls — separate from the pipeline's llm.invoke span,
    # which covers the chat LLM only.
    "dataprep_llm_model": "dataprep.llm_model",
    "dataprep_llm_batched": "dataprep.llm_batched",
    "dataprep_llm_batch_size": "dataprep.llm_batch_size",
    "dataprep_llm_attempt": "dataprep.llm_attempt",
    "dataprep_llm_prompt_tokens": "dataprep.llm.prompt_tokens",
    "dataprep_llm_completion_tokens": "dataprep.llm.completion_tokens",
    # Set when the call hit its HTTP budget. Without it a timed-out span closes
    # with no tokens and no distinguishing attribute, so a wedged GPU and a
    # call still in flight are indistinguishable in the trace.
    "dataprep_llm_timed_out": "dataprep.llm.timed_out",
    "dataprep_llm_timeout_seconds": "dataprep.llm.timeout_seconds",
    # Set on the phase-level span (dataprep.llm.phase) so one trace says which
    # phase exhausted its budget when a document runs both labelling and
    # Contextual Retrieval under the same ceiling.
    "dataprep_llm_phase": "dataprep.llm.phase",
    # Contextual Retrieval — the per-chunk doc-context generation
    "dataprep_contextual_retrieval": "dataprep.contextual_retrieval",
    "dataprep_contextual_strategy": "dataprep.contextual_strategy",
    "dataprep_context_chars": "dataprep.context_chars",
    "dataprep_contexts_generated": "dataprep.contexts_generated",
    "dataprep_partial_recovery_count": "dataprep.partial_recovery_count",
    # Labelling + overflow
    "dataprep_labels_suggested": "dataprep.labels_suggested",
    "dataprep_input_too_long": "dataprep.input_too_long",
    # ------------------------------------------------------------------------
    # chatqna.query_condense — the multi-turn query rewrite. This span sits
    # directly beside the user's query text, so it is swept for the same reason
    # dataprep.ingest is: nothing structural keeps the query off it.
    #
    # ``genie.condense.mode`` is read from ``MULTI_TURN_MODE``, an operator-set
    # env var, not user input — but it is still free-form text from the
    # environment's point of view, and the shape rule is what makes a typo'd
    # value like ``MULTI_TURN_MODE="condense v2"`` fail a test that drives this
    # emission through the exporter, rather than being emitted unremarked.
    # Status and counters are emitted as declared.
    # ------------------------------------------------------------------------
    "condense_mode": "genie.condense.mode",
    "condense_status": "genie.condense.status",
    "condense_latency_ms": "genie.condense.latency_ms",
    "condense_prompt_tokens": "genie.condense.prompt_tokens",
    "condense_completion_tokens": "genie.condense.completion_tokens",
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
# it". They are therefore legacy, not pending-deletion, and each entry records
# what it is rather than a task that does not exist.
#
# Each reason is drawn from ``LEGACY_REASONS`` below. That is deliberate: a
# free-text reason is unfalsifiable prose, and this set already shipped three
# reasons that read true in the abstract ("eval-harness contract") while being
# false of the keys they were attached to. A closed vocabulary plus
# ``tests/test_span_attrs.py::TestLegacyReasons`` pinning which keys carry which
# reason makes a wrong claim a test failure rather than something a reviewer has
# to remember to re-audit.
#
# What this set does NOT do is relax the privacy guard: a registered legacy key is
# still subject to the full layer-2 shape check, so prose on any of these is still
# a violation.
LEGACY_ATTRIBUTE_NAMES = {
    # chatqna.reranker_selection — genieai_chatqna.py:114-118.
    # rag.adaptive_chunk_keys is a PARALLEL array and does not reshape these.
    # Exactly two of these five are the eval-harness contract
    # (tests/rag-benchmarks/eval/run_eval.py:331-332); the other three are
    # chatqna-local diagnostics with no reader outside the write site.
    #
    # The first two carry the JOIN SENTINEL "N/A" where a chunk could not be
    # resolved — see the note on ``rag.candidate_keys`` in ATTRIBUTE_NAMES for
    # why that literal differs from the reranker's ``UNRESOLVED`` and why
    # changing it is off limits.
    "rag.candidate_chunk_keys": "legacy: eval-harness contract",
    "rag.selected_chunk_keys": "legacy: eval-harness contract",
    "rag.selected_scores": "legacy: no production reader outside its write site",
    "rag.candidate_count": "legacy: no production reader outside its write site",
    "rag.selected_count": "legacy: no production reader outside its write site",
    # retriever.hybrid_search — genieai_retriever_arangodb.py:878-879.
    # rag.search_type and rag.fetch_k sit beside these; neither replaces the pair
    # at 878-879.
    "rag.search_mode": "legacy: superseded in meaning, not in emission",
    "rag.top_k": "legacy: superseded in meaning, not in emission",
    # rag.chunk_count is written on BOTH retriever.hybrid_search
    # (:1428) and chatqna.orchestrate (genieai_chatqna.py:2870).
    "rag.chunk_count": "legacy: written on two spans, unchanged on both",
    "retriever.summarizer.input_too_long": "legacy: pre-existing write site, unchanged",
    "retriever.summarizer.overflow_count": "legacy: pre-existing write site, unchanged",
    # reranker.tei_invoke — genieai_tei_reranker.py. rag.adaptive_chunk_keys is
    # added alongside these and removes nothing.
    "reranker.strategy": "legacy: pre-existing write site, unchanged",
    "reranker.top_n": "legacy: pre-existing write site, unchanged",
    "reranker.model_id": "legacy: pre-existing write site, unchanged",
    "reranker.input_doc_count": "legacy: pre-existing write site, unchanged",
    "reranker.output_doc_count": "legacy: pre-existing write site, unchanged",
    "reranker.score_threshold": "legacy: pre-existing write site, unchanged",
    "reranker.input_too_long": "legacy: pre-existing write site, unchanged",
    "reranker.rejected_tokens": "legacy: pre-existing write site, unchanged",
    "rag.adaptive_context_decay_factor": "legacy: pre-existing write site, unchanged",
    "rag.adaptive_min_value_threshold": "legacy: pre-existing write site, unchanged",
    # chatqna.orchestrate — genieai_chatqna.py:2891. Nothing removes this write;
    # the abstention flag added on a DIFFERENT span (chatqna.stream_outcome) is
    # additive. The two coexist: a per-request reason here, a per-response flag
    # there.
    "abstained.reason": "legacy: survives — a new flag lands on a different span, this one is not removed",
}

# The complete set of reasons a LEGACY_ATTRIBUTE_NAMES value may carry.
#
# Closed on purpose (see the block comment above). A test asserts membership in
# both directions: no entry may use a reason outside this set, and no reason here
# may go unused — so the vocabulary cannot silently rot into "any string passes".
LEGACY_REASONS = frozenset(
    {
        "legacy: eval-harness contract",
        "legacy: no production reader outside its write site",
        "legacy: superseded in meaning, not in emission",
        "legacy: written on two spans, unchanged on both",
        "legacy: pre-existing write site, unchanged",
        "legacy: survives — a new flag lands on a different span, this one is not removed",
    }
)

# The keys the retrieval-quality eval harness actually reads. Pinned as data so
# the claim in the comment above it is checkable against the harness source
# rather than asserted by hand.
EVAL_HARNESS_KEYS = frozenset({"rag.candidate_chunk_keys", "rag.selected_chunk_keys"})

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
# ``rag.selected_chunk_keys`` / ``rag.adaptive_chunk_keys`` are FLAT lists
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
    ``LEGACY_ATTRIBUTE_NAMES`` (emitted today, outside that vocabulary and
    all of it surviving this work). Registering a legacy key relaxes nothing
    about its VALUE — layer 2 applies identically to both sets, so prose on a
    legacy key is still caught.

    Layer 2: a string value with whitespace, or longer than MAX_STRING_LEN, is
    prose. Shape-based on purpose: a denylist of forbidden substrings rots and is
    defeated by wording nobody anticipated, whereas whitespace and length are
    properties no phrasing avoids.
    """
    registered = set(ATTRIBUTE_NAMES.values()) | set(LEGACY_ATTRIBUTE_NAMES)
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


def query_id_from_baggage(context=None) -> str | None:
    """Return the ``genie.query_id`` correlation id from a baggage-carrying context.

    Reads the ACTIVE context unless ``context`` is given. Pass the captured
    context explicitly wherever the span is parented to something other than the
    current context: a context derived with ``set_span_in_context`` RETAINS its
    baggage, so the captured handle is the more reliable source — it does not
    depend on the id still being in scope wherever the span happens to be opened.

    ``None`` when the caller sent no baggage — any client that is not the Node
    backend, or a hand-crafted request. Callers omit the attribute in that case
    rather than writing a placeholder, so "no correlation id" stays
    distinguishable from "empty correlation id".
    """
    from opentelemetry import baggage as _baggage

    return _baggage.get_baggage(QUERY_ID_KEY, context=context)
