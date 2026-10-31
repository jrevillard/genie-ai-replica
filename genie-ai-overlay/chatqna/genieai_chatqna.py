# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import argparse
import ast
import asyncio
import copy
import json
import math
import os
import re
import time
from datetime import date, datetime
from functools import lru_cache
from urllib.parse import urlparse

from metrics import (
    chat_rag_duration_seconds,
    chat_requests_total,
    history_truncation_total,
    sanitize_attributes,
)

from core.embedding_query_prefix import TEI_EMBED_MODEL, get_query_instruction
from core.label_contract import build_filter_labels, encode_filter_labels
from core.model_cache import (
    MAX_SANE_MODEL_WINDOW_TOKENS,
    ModelDiscoveryError,
    TokenCountError,
    coerce_int,
    discover_model_id,
    get_max_model_len,
    get_model_id,
    resolve_model_id,
)
from core.model_http_policy import (
    AIOHTTP_CONNECT_TIMEOUT_SECONDS,
    CONTROL_PLANE_TIMEOUT_SECONDS,
    PROBE_TIMEOUT_SECONDS,
    endpoint_auth_headers,
    endpoint_verify,
)
from core.span_attrs import ATTRIBUTE_NAMES, QUERY_ID_KEY, QUERY_TRANSLATION_STATUSES, query_id_from_baggage
from tracing import (
    get_tracer,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
    setup_tracing,
    with_span,
)

setup_tracing("genieai-chatqna")

import aiohttp  # for async http requests
import httpx
from opentelemetry import context as otel_context
from opentelemetry import trace as otel_trace
from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

HTTPXClientInstrumentor().instrument()
AioHttpClientInstrumentor().instrument()

from comps import CustomLogger, MegaServiceEndpoint, MicroService, ServiceOrchestrator, ServiceRoleType, ServiceType
from comps.cores.proto.docarray import LLMParams, RerankerParms, RetrieverParms
from comps.cores.proto.genieai_api_protocol import (
    ChatCompletionRequest,
)
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from keycloak_token_validator import JwksUnavailableError, validate_token
from langdetect import detect

logger = CustomLogger("GENIE.AI_CHATQNA")
setup_trace_logging("GENIE.AI_CHATQNA")
setup_json_logging("GENIE.AI_CHATQNA")
install_uvicorn_access_logging()

# Tracer for pipeline-node-level spans emitted from align_outputs (e.g. the
# reranker-selection identity span used by the retrieval-quality eval harness).
# The orchestrate handler keeps its own scope-local tracer; this one serves the
# service-merge path where both candidate and selected chunk ids are known.
align_tracer = get_tracer("chatqna.align_outputs")

# Tracer for the per-LLM-call span. Separate from align_tracer because the
# llm.invoke span is opened with start_span (not start_as_current_span) and its
# lifetime is owned by the streaming generator, not by an orchestrator node.
#
# UNVERIFIED, and stated rather than assumed: whether comps invokes the align
# function inside handle_request's orchestrate block cannot be checked from this
# tree. `comps` is vendored at build time, is not installed in the test venv, and
# no Docker is available here. `align_generator` therefore captures the active
# context when it is CALLED and parents the span on that, which closes the window
# where a lazily-iterated generator would open its span against the request task's
# context and start a new trace. If comps hands the chain over before the
# orchestrate block closes, that capture is the orchestrate context and the span
# joins the RAG trace; if it hands it over after, the capture is still earlier
# than first iteration but may not be the RAG trace. Which of the two happens is
# a fact about comps, not about this file.
llm_tracer = get_tracer("chatqna.llm")

# Tracer for the answer-level outcome of a streamed turn. The span is opened by
# the streaming generator once the orchestrate span has ended, so it is parented
# on the orchestrate context captured by handle_request rather than on whatever
# context happens to be active at that point.
stream_outcome_tracer = get_tracer("chatqna.stream_outcome")

# Sampling parameters recorded on spans, keyed by the field name they carry on
# the wire. Shared so the llm.invoke span and the chatqna.orchestrate span stamp
# the same set under the same names — one vocabulary, one place to add a
# parameter.
#
# Every entry here is a field `align_inputs` writes into `next_inputs`. A
# parameter chatqna never sends is deliberately absent: `repetition_penalty` is
# the obvious candidate (it is in the span vocabulary, because it is a real vLLM
# sampling parameter) but chatqna does not put it in the request body, so
# recording a value for it would advertise a parameter vLLM never received.
# Add it here in the same commit that adds the `next_inputs` write.
_LLM_REQUEST_PARAM_ATTRS = (
    ("max_tokens", "llm_req_max_tokens"),
    ("top_p", "llm_req_top_p"),
    ("temperature", "llm_req_temperature"),
    ("frequency_penalty", "llm_req_frequency_penalty"),
)


class _RerankerInputTooLongError(Exception):
    """Local marker raised in align_outputs (RERANK branch) of this service.

    The reranker microservice translates the typed wrapper exception into a
    422 HTTPException. OPEA v1.5's ServiceOrchestrator.execute() does not
    check HTTP status (no raise_for_status), so the 422 body flows into
    align_outputs as the reranker node's output dict; the detection there
    raises this class, which propagates out of schedule() and is caught by
    the abstention handler in handle_request. A secondary, defensive chain
    walk in handle_request also maps any wrapped marker-bearing exception
    onto this class.
    """


class TranslationInputTooLongError(RuntimeError):
    """Raised when the translation service rejects a chunk for context-length overflow.

    Server-side fail-loud: triggered by HTTP 400 with ``context_length_exceeded``
    / ``maximum context length`` markers in the response body. The translation
    path runs synchronously inside handle_request's chat flow (unlike dataprep's
    async-fire-and-forget ingest). Failure-mode contract: a fail-loud typed
    exception lets the route layer map this to HTTP 422 so the BFF chat UI
    surfaces the translation failure instead of silently passing through a
    half-translated / English fallback that breaks the multilingual UX
    (issue #829).
    """


class TranslationFailedError(RuntimeError):
    """Raised when a translation chunk could not be translated.

    The translation model failed (an error, a timeout, or an empty answer) for
    a chunk of an answer. The failure is raised rather than answered with the
    English source: a chunk that goes through untranslated leaves the answer
    half-translated, and an answer that reads as a translation but is not one
    is the failure the translation status exists to report.

    The caller decides what an untranslated answer means: the answer path
    keeps the English answer and reports ``"failed"``, while the history path
    — a text that is normalized for the retriever and never shown — falls back
    to the English source.
    """


class TranslationTimeoutError(TranslationFailedError):
    """A translation chunk timed out waiting for the model.

    A subtype, not a separate family: every ``except TranslationFailedError``
    keeps working, while the history path — which reports whether the
    translation service was slow or broken — can classify the timeout by
    ``isinstance`` instead of unwrapping ``__cause__``.
    """


# Token-budget markers in vLLM/OpenAI error bodies. Shared with the dataprep
# fail-loud pattern (dataprep/genieai_dataprep_arangodb.py).
# Protocol marker carried in the reranker microservice's 422 body
# (detail.error_type) and in wrapped exception messages. Both detection
# points (align_outputs body check + the defensive chain walk) key on it.
_RERANKER_INPUT_TOO_LONG_TYPE = "RerankerInputTooLong"


def _emit_reranker_selection_span(candidate_chunk_keys, selected_chunk_keys, selected_scores):
    """Emit reranker selection identity for retrieval-quality evaluation.

    Emits ``chunk_key`` (the ArangoDB ``_key``) for candidates + selected. The
    keys are recovered in ``align_outputs`` from the retriever's parallel
    ``data["metadata"]`` list (same path as ``chunk_embedding`` — TextDoc has no
    metadata field, so the retriever stashes per-chunk metadata there). The
    eval harness at ``tests/rag-benchmarks/eval/`` matches ``chunk_key`` against
    ``gold_dataset.json`` expected ``chunk_key`` to compute recall / precision /
    complete-recall / noise. Extracted as a helper for isolated unit testing.
    """
    with align_tracer.start_as_current_span("chatqna.reranker_selection") as sel_span:
        sel_span.set_attribute("rag.candidate_chunk_keys", candidate_chunk_keys)
        sel_span.set_attribute("rag.selected_chunk_keys", selected_chunk_keys)
        sel_span.set_attribute("rag.selected_scores", selected_scores)
        sel_span.set_attribute("rag.candidate_count", len(candidate_chunk_keys))
        sel_span.set_attribute("rag.selected_count", len(selected_chunk_keys))
        _query_id = query_id_from_baggage()
        if _query_id:
            sel_span.set_attribute(QUERY_ID_KEY, _query_id)


def _llm_request_params(llm_parameters_dict) -> dict:
    """Return comps' LLM parameters as a plain mapping.

    ``llm_parameters_dict`` arrives as a dict in the sync/streaming align
    hooks. Tolerating a pydantic-style object costs nothing and keeps the
    callers free of the distinction.
    """
    if not llm_parameters_dict:
        return {}
    if hasattr(llm_parameters_dict, "get"):
        return llm_parameters_dict
    for attr in ("model_dump", "dict"):
        dumper = getattr(llm_parameters_dict, attr, None)
        if callable(dumper):
            try:
                return dict(dumper())
            except Exception:
                break
    return {}


def _record_llm_request_params(span, request_fields) -> None:
    """Stamp the sampling params carried by ``request_fields`` onto ``span``.

    ``request_fields`` is the request body where one is available — the
    ``next_inputs`` ``align_inputs`` assembles — so the span reports what goes on
    the wire, not what a parameter dictionary intended. The two differ: chatqna
    takes ``temperature`` and ``frequency_penalty`` from ``inputs``, not from
    ``llm_parameters_dict``.

    Each param is written ONLY when present: absence is the signal this span
    exists to surface (a param dropped between chatqna and vLLM), so no
    sentinel values are written in its place.
    """
    params = _llm_request_params(request_fields)
    for key, attr in _LLM_REQUEST_PARAM_ATTRS:
        value = params.get(key)
        if value is not None:
            span.set_attribute(ATTRIBUTE_NAMES[attr], value)


def _stamp_llm_request_params_on_current_span(request_fields) -> None:
    """Record the request params on the enclosing chatqna.orchestrate span.

    Called from the ``align_inputs`` LLM branch with the assembled
    ``next_inputs``. ``align_inputs`` is also the one hook guaranteed to see
    ``llm_parameters_dict`` as a named positional, while ``align_generator`` is
    only reachable through ``**kwargs`` and whether comps forwards the dict
    there cannot be verified from this source tree — recording the params here
    as well means they reach a span either way. A module-level holder was
    rejected: chatqna serves concurrent turns, so mutable module state would
    interleave between requests.
    """
    span = otel_trace.get_current_span()
    if span is None or not span.is_recording():
        return
    _record_llm_request_params(span, request_fields)


def _emit_llm_invoke_open(llm_parameters_dict: dict, *, stream_known: bool | None = None, parent_context=None):
    """Open the llm.invoke span and record the request parameters.

    ``start_span``, not ``start_as_current_span``: the latter returns an
    ``_AgnosticContextManager``, not a Span, and calling ``set_attribute`` on it
    raises AttributeError. The streaming path needs a real Span whose lifetime
    it owns — open across the generator's yields, closed from a finally when the
    upstream raises or the consumer abandons the stream.

    The two ``align`` hooks that open this span have no request body in scope,
    so the parameters come from ``llm_parameters_dict`` — comps' record of the
    request it is about to issue. That is the best available source here, and it
    is why the authoritative copy lands on ``chatqna.orchestrate``, stamped from
    ``next_inputs`` in ``align_inputs``.

    ``stream_known`` carries what the CALL SITE knows about streaming, which the
    parameter dict cannot always be asked for. ``align_generator`` IS the
    streaming branch — the non-streaming LLM branch of ``align_outputs`` is
    guarded on ``not llm_parameters_dict["stream"]`` — but it reaches this
    function only through ``**kwargs``, and whether comps forwards the dict
    there cannot be verified from this source tree. Deriving ``llm.stream`` from
    an absent dict therefore records ``false`` on the one span whose job is to
    report what the LLM call was, and confidently-wrong data is worse than none.

    With ``stream_known`` set, ``llm.stream`` is that value.
    ``llm.stream_options.include_usage`` is different: it is only emitted when
    the dict actually carried ``stream``, because whether the request asked for
    usage alongside the stream is genuinely unknown without it. Absence is the
    correct degradation for an unknown; a guessed ``true`` is not. When
    ``stream_known`` is None the dict is the only source and both attributes
    resolve from it, so they cannot disagree.

    ``parent_context`` parents the span to an explicitly captured context instead
    of whatever is active at open time. A lazily-started generator can be
    consumed after the orchestrating span has closed, at which point the active
    context belongs to the request task and an unparented span starts a NEW
    trace.
    """
    params = _llm_request_params(llm_parameters_dict)
    stream_observed = bool(params.get("stream"))
    stream = stream_observed if stream_known is None else bool(stream_known)
    parent_ctx = otel_context.get_current() if parent_context is None else parent_context
    span = llm_tracer.start_span("llm.invoke", context=parent_ctx)
    span.set_attribute(ATTRIBUTE_NAMES["llm_stream"], stream)
    _record_llm_request_params(span, params)
    if stream_observed:
        span.set_attribute(ATTRIBUTE_NAMES["llm_stream_options_include_usage"], True)
    _query_id = query_id_from_baggage(context=parent_ctx)
    if _query_id:
        span.set_attribute(QUERY_ID_KEY, _query_id)
    return span


def _emit_llm_invoke_record(span, response) -> None:
    """Record model, token usage and finish_reason from one OpenAI response.

    Accepts a single chunk while streaming: fields absent from that chunk are
    not written, so the chunk that carries usage lands them.
    """
    if not isinstance(response, dict):
        return
    model = response.get("model")
    if model:
        span.set_attribute(ATTRIBUTE_NAMES["llm_model"], model)
    usage = response.get("usage")
    if isinstance(usage, dict):
        for key, attr in (
            ("prompt_tokens", "llm_usage_prompt_tokens"),
            ("completion_tokens", "llm_usage_completion_tokens"),
            ("total_tokens", "llm_usage_total_tokens"),
        ):
            value = usage.get(key)
            if value is not None:
                span.set_attribute(ATTRIBUTE_NAMES[attr], value)
    choices = response.get("choices")
    if not isinstance(choices, (list, tuple)):
        return
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        reason = choice.get("finish_reason")
        if reason:
            span.set_attribute(ATTRIBUTE_NAMES["llm_finish_reason"], reason)


def _emit_llm_invoke_close(span) -> None:
    """End the llm.invoke span."""
    span.end()


def _emit_stream_outcome_span(
    parent_context,
    retrieval_confidence: float,
    self_confidence,
    is_grounded: bool,
    sentinel_present: bool,
    abstained: bool,
    abstention_reason: str | None = None,
) -> None:
    """Record the answer-level outcome of a streamed turn.

    A span of its own, not an attribute on chatqna.orchestrate: the streaming
    body is iterated by the framework AFTER the orchestrate span has ended, so
    anything written to that span by then is dropped without error.

    ``parent_context`` is the context captured from chatqna.orchestrate before
    its ``with`` block closed, and it is what makes the span join the RAG trace.
    By the time the body is consumed the active context belongs to the request
    task, so a span opened without an explicit parent starts a NEW trace and the
    outcome never appears next to the retrieval and reranking spans an operator
    is looking at.
    """
    span = stream_outcome_tracer.start_span("chatqna.stream_outcome", context=parent_context)
    try:
        if span.is_recording():
            # Read from ``parent_context``, not the active context: that handle
            # was derived with set_span_in_context, which RETAINS the baggage it
            # was created from, so it still carries the id even when the span is
            # opened somewhere the baggage is no longer in scope. Omitted when
            # no client sent one.
            _query_id = query_id_from_baggage(context=parent_context)
            if _query_id:
                span.set_attribute(QUERY_ID_KEY, _query_id)
            span.set_attribute(ATTRIBUTE_NAMES["retrieval_confidence"], float(retrieval_confidence))
            # Omitted, never nulled: an absent self-grade means the sentinel
            # never completed, which is a different fact from a score of 0.
            if self_confidence is not None:
                span.set_attribute(ATTRIBUTE_NAMES["llm_self_confidence"], float(self_confidence))
            span.set_attribute(ATTRIBUTE_NAMES["answer_is_grounded"], bool(is_grounded))
            span.set_attribute(ATTRIBUTE_NAMES["answer_sentinel_present"], bool(sentinel_present))
            span.set_attribute(ATTRIBUTE_NAMES["answer_abstained"], bool(abstained))
            # Empty when the turn did not abstain: a stable four-value
            # vocabulary (the three machine codes + "") keeps the metric and
            # the span attributable without per-call attr-shape changes.
            span.set_attribute(ATTRIBUTE_NAMES["answer_abstention_reason"], abstention_reason or "")
    finally:
        span.end()


# Respect LOG_LEVEL: patch uvicorn's LOGGING_CONFIG (applied at startup via
# dictConfig — this overrides import-time setLevel) so DEBUG actually works.
# uvicorn 0.34's default config has no "root" key + handler at NOTSET → DEBUG
# never propagated. Verified against uvicorn 0.34.2. Default INFO → prod-safe.
try:
    import uvicorn.config

    _log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    uvicorn.config.LOGGING_CONFIG["handlers"]["default"]["level"] = _log_level
    uvicorn.config.LOGGING_CONFIG["root"] = {"handlers": ["default"], "level": _log_level}
    uvicorn.config.LOGGING_CONFIG["loggers"]["GENIE.AI_CHATQNA"] = {
        "handlers": ["default"],
        "level": _log_level,
        "propagate": False,
    }
except ImportError:
    pass  # uvicorn not available (test env); the patch only matters at runtime

logflag = os.getenv("LOGFLAG", True)


def _env_int(name: str, default: int) -> int:
    """Parse an int env var tolerantly: unset OR set-to-empty (compose's
    default injection for the semantic knobs) or non-numeric values all fall
    back to the default instead of crash-looping the service at import.

    Defined here (above the MULTI_TURN_* constants) so the int-with-default
    env knobs in this file can use it; previously the condense knob used a
    bare ``int(os.getenv(...))`` that crashed at import when the env var
    was empty or non-numeric (findings #3 / issue #1091). Mirrors the same
    tolerant pattern used elsewhere (see ``MAX_MODEL_LEN_TEXTGEN``)."""
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    """Parse a float env var tolerantly — same contract as ``_env_int``:
    unset, set-to-empty, or non-numeric values fall back to the default."""
    try:
        return float(os.getenv(name) or default)
    except ValueError:
        return default


MEGA_SERVICE_PORT = _env_int("MEGA_SERVICE_PORT", 8888)
GUARDRAIL_SERVICE_HOST_IP = os.getenv("GUARDRAIL_SERVICE_HOST_IP", "0.0.0.0")
GUARDRAIL_SERVICE_PORT = int(os.getenv("GUARDRAIL_SERVICE_PORT", 80))
TRANSLATION_SERVICE_HOST_IP = os.getenv("TRANSLATION_SERVICE_HOST_IP", "0.0.0.0")
TRANSLATION_SERVICE_PORT = int(os.getenv("TRANSLATION_SERVICE_PORT", 80))
TRANSLATION_SERVICE_TIMEOUT = int(
    os.getenv("TRANSLATION_SERVICE_TIMEOUT", 180)
)  # Timeout in seconds for translation service (default: 3 minutes)
TRANSLATION_MODEL_ID = os.getenv("VLLM_TRANSLATION_MODEL_ID", "")
# Connect directly to vLLM for translation when VLLM_TRANSLATION_ENDPOINT is set,
# bypassing the OPEA translation microservice which reformats payloads and breaks
# TranslateGemma's structured chat template. Falls back to OPEA proxy if not set.
_VLLM_TRANSLATION_ENDPOINT = os.getenv("VLLM_TRANSLATION_ENDPOINT", "")
# Translation base URL — the single construction of the remote-vs-compose
# rule: direct vLLM when VLLM_TRANSLATION_ENDPOINT is set (bypassing the OPEA
# translation microservice, which reformats payloads and breaks TranslateGemma's
# structured chat template), the compose-internal translation vLLM otherwise.
# Every translation consumer derives from it, including window discovery.
_TRANSLATION_DISCOVERY_ENDPOINT = _VLLM_TRANSLATION_ENDPOINT or (
    f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}"
)
TRANSLATION_LLM_URL = f"{_TRANSLATION_DISCOVERY_ENDPOINT}/v1/chat/completions"
TRANSLATION_COMPLETIONS_URL = f"{_TRANSLATION_DISCOVERY_ENDPOINT}/v1/completions"
EMBEDDING_SERVER_HOST_IP = os.getenv("EMBEDDING_SERVER_HOST_IP", "0.0.0.0")
EMBEDDING_SERVER_PORT = int(os.getenv("EMBEDDING_SERVER_PORT", 80))
EMBEDDING_SERVER_ENDPOINT = os.getenv("EMBEDDING_SERVER_ENDPOINT", "/v1/embeddings")


# Multi-turn vector-space blending (issue #833). When enabled, the query
# embedding is blended with the previous N turns' embedding
# (V = α·EQ + (1-α)·EH) at the retriever's dense leg, so pronoun-heavy
# follow-ups ("can you elaborate on this?") retrieve the prior turn's subject.
# Default OFF (true no-op: history_embedding stays None → no blending).
# Query-time feature; UNRELATED to ingest-time CONTEXTUAL_RETRIEVAL_ENABLED.
# Under the default production config (HYBRID_RETRIEVAL_ENABLED=false), the
# retriever is dense-only so the blended vector controls all retrieval. When
# hybrid is explicitly enabled (opt-in), only the dense leg is blended — the
# BM25 lexical leg still uses the isolated query text.
MULTI_TURN_BLEND_ENABLED = os.getenv("MULTI_TURN_BLEND_ENABLED", "false").lower() == "true"
MULTI_TURN_BLEND_ALPHA = float(os.getenv("MULTI_TURN_BLEND_ALPHA", "0.7"))
MULTI_TURN_HISTORY_TURNS = int(os.getenv("MULTI_TURN_HISTORY_TURNS", "1"))
# Multi-turn retrieval mode (issue #1091): "blend" = issue-#833 vector-space
# blending (default, unchanged); "condense" = per-turn standalone-query
# rewrite — one short LLM call rewrites the follow-up, retrieval AND rerank
# use the rewritten query, fail-closed on any rewrite failure.
MULTI_TURN_MODE = os.getenv("MULTI_TURN_MODE", "blend").strip().lower()
# Conversation segments (USER/ASSISTANT messages, same semantics as
# _extract_history_text) fed to the condense rewrite. Dedicated knob: the
# blend's MULTI_TURN_HISTORY_TURNS stays blend-only so deleting the blend
# later does not orphan condense semantics.
MULTI_TURN_CONDENSE_HISTORY_TURNS = _env_int("MULTI_TURN_CONDENSE_HISTORY_TURNS", 8)
RETRIEVER_SERVICE_HOST_IP = os.getenv("RETRIEVER_SERVICE_HOST_IP", "0.0.0.0")
RETRIEVER_SERVICE_PORT = int(os.getenv("RETRIEVER_SERVICE_PORT", 7025))
RERANK_SERVER_HOST_IP = os.getenv("RERANK_SERVER_HOST_IP", "0.0.0.0")
RERANK_SERVER_PORT = int(os.getenv("RERANK_SERVER_PORT", 80))
LLM_SERVER_HOST_IP = os.getenv("LLM_SERVER_HOST_IP", "0.0.0.0")
LLM_SERVER_PORT = int(os.getenv("LLM_SERVER_PORT", 80))
LLM_SERVER_PROTOCOL = "http"
# When VLLM_LLM_ENDPOINT is set (e.g. https://gpu-host/llm for remote GPU node),
# override host/port/protocol so MicroService constructs the correct URL.
_VLLM_LLM_ENDPOINT = os.getenv("VLLM_LLM_ENDPOINT", "")
if _VLLM_LLM_ENDPOINT:
    _parsed = urlparse(_VLLM_LLM_ENDPOINT)
    LLM_SERVER_HOST_IP = _parsed.hostname or LLM_SERVER_HOST_IP
    LLM_SERVER_PORT = _parsed.port or 443
    LLM_SERVER_PROTOCOL = _parsed.scheme or "https"
    LLM_SERVER_ENDPOINT_PREFIX = _parsed.path.rstrip("/") or ""
else:
    LLM_SERVER_ENDPOINT_PREFIX = ""

# Endpoint the model-id and context-window discovery probes: the remote GPU
# node when configured, otherwise the compose-internal vLLM
# (LLM_SERVER_HOST_IP:PORT — chatqna already talks to it for generation).
# Probing is always on; the model-id getter fails loudly when nothing
# answers, the window getters fall back to the configured constants.
_LLM_DISCOVERY_ENDPOINT = _VLLM_LLM_ENDPOINT or f"http://{LLM_SERVER_HOST_IP}:{LLM_SERVER_PORT}"


def _get_llm_model() -> str:
    """Return the model ID served at ``_LLM_DISCOVERY_ENDPOINT``.

    Standing invariants: the chatqna image bakes no HuggingFace cache and
    the deployment grants no hub egress, so the endpoint itself is the only
    trustworthy source for the name; and every payload sent to it
    (generation, condense, tokenize) must carry the discovered id because
    vLLM validates the model name and 404s unknown ones. The VLLM_MODEL_ID
    env (core.model_cache.resolve_model_id) is the deployer's escape hatch
    for endpoints whose /v1/models is unreachable while generation works.
    """
    return resolve_model_id(_LLM_DISCOVERY_ENDPOINT)


def _get_translation_model_id() -> str | None:
    """Return the translation model ID: the explicit VLLM_TRANSLATION_MODEL_ID
    env when the deployer set it, otherwise the id discovered at
    ``_TRANSLATION_DISCOVERY_ENDPOINT`` — None when neither answers.

    None is a valid state: the generic translation path sends no model name;
    only the TranslateGemma completions payloads need one.
    """
    return TRANSLATION_MODEL_ID or get_model_id(_TRANSLATION_DISCOVERY_ENDPOINT)


def _is_translategemma(translation_model_id: str | None) -> bool:
    """True when the active translation model is TranslateGemma.

    TranslateGemma uses the completions API with a pre-formatted prompt;
    other models use the chat completions API. Callers pass the id they
    already resolved, so one read decides the payload AND the response
    parse (a second read would re-probe and could disagree).
    """
    return bool(translation_model_id) and "translategemma" in translation_model_id.lower()


# Window discovery shares the model-id cache entry, so the MODEL_DETECT_TTL
# env var governs its refresh cadence too (under traffic the entry is
# refreshed every 60 s by the model-id accessors regardless of the window).


def _build_user_content(user_context_string: str, history_string: str, rag_augmented_prompt: str) -> str:
    """The user-message template — the single source for prompt assembly, the
    truncation-budget skeleton, and the post-truncation rebuild, so the
    measured budget always matches what is finally sent."""
    return (
        f"\n\nUSER INFORMATION:\n{user_context_string}"
        f"\n\nCHAT HISTORY:\n{history_string}"
        f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \n{rag_augmented_prompt}"
    )


def _translation_base_cap(text: str) -> int:
    """Base completion cap for a translation request: roughly half the input
    size, bounded to a floor that keeps short inputs translatable and a
    ceiling that keeps long ones bounded. Shared by every translation path."""
    return min(max(len(text) // 2, 512), 4096)


def _get_max_model_len() -> int:
    """Return the usable LLM context window in tokens, in three tiers.

    1. A deployer-set MAX_MODEL_LEN_TEXTGEN (env read at call time) wins — a
       deliberate consumer-side cap (e.g. keep the model off its full window
       under load) without touching the GPU config. Use the vLLM
       --max_model_len flag instead to cap what the model serves.
    2. Otherwise the endpoint is probed (remote GPU node when VLLM_LLM_ENDPOINT
       is set, otherwise the compose-internal vLLM) for ``max_model_len`` —
       TTL-cached, sharing the probe with model-id detection.
    3. The 65536 code default (project-standard Granite) only when the probe
       has no answer (unreachable endpoint, missing field — logged by
       core.model_cache).
    """
    explicit = _env_int("MAX_MODEL_LEN_TEXTGEN", 0)
    if explicit > 0:
        return explicit
    detected = get_max_model_len(_LLM_DISCOVERY_ENDPOINT)
    if detected:
        return detected
    return MAX_MODEL_LEN_TEXTGEN


def _get_translation_window() -> int | None:
    """Return the discovered translation-model window in tokens, or None.

    None only until a probe has ever succeeded — model_cache serves the last
    known (stale) window when a re-probe fails, and None when the endpoint is
    unreachable from the start or does not expose the field.
    """
    return get_max_model_len(_TRANSLATION_DISCOVERY_ENDPOINT)


def _get_max_translation_chars() -> int:
    """Return the character budget for history forwarded to the translation model.

    Derived from the discovered translation-model window so that the prompt
    plus the completion (an input-sized translation) fit inside it; a
    deployer-set MAX_TRANSLATION_CHARS caps that derivation (the dense-script
    mitigation — CJK runs ~1 token/char, not 3), and the same configured value
    is the fallback when the probe has no answer. Discovery gaps are logged by
    core.model_cache.
    """
    window = _get_translation_window()
    if not window:
        return _env_int("MAX_TRANSLATION_CHARS", MAX_TRANSLATION_CHARS)
    budget = (window - TRANSLATION_PROMPT_OVERHEAD_TOKENS) // 2 * TRANSLATION_CHARS_PER_TOKEN
    explicit = _env_int("MAX_TRANSLATION_CHARS", 0)
    if explicit > 0:
        budget = min(budget, explicit)
    return max(budget, 1)


# Translation budget derivation from the discovered window. The completion
# reserve assumes the translated output is roughly the size of the input (the
# TranslateGemma payload also caps max_tokens near half the window).
TRANSLATION_PROMPT_OVERHEAD_TOKENS = 512


def _flatten_history_string(history: list) -> str:
    """Flatten the chat history into the role-tagged string every consumer
    shares: the translation prompt (and its untranslated fallback), and the
    passthrough flatten when the history is already in English. One recipe,
    so a translated and a passthrough history for the same messages differ
    only in the words, never in the format. A message with no role key
    flattens as ``UNKNOWN:`` and a message with no content key flattens as
    an empty content."""
    parts = []
    for message in history:
        role = message.get("role", "unknown").upper()
        content = message.get("content", "")
        parts.append(f"{role}: {content}")
    return " |<-MSG->| ".join(parts)


TRANSLATION_CHARS_PER_TOKEN = 3  # conservative: Spanish runs ~4-5 chars/token
# Rough per-message overhead in the flattened history ("USER: " / "ASSISTANT: "
# prefixes plus the " |<-MSG->| " separator) — the char budget counts content
# only, so each kept message is charged this allowance.
TRANSLATION_MSG_OVERHEAD_CHARS = 20


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", None)

RETRIEVER_SEARCH_START = os.getenv("RETRIEVER_ARANGO_SEARCH_START", "chunk")  # node | edge | chunk
RETRIEVER_K = int(os.getenv("RETRIEVER_ARANGO_K", 4))
RETRIEVER_FETCH_K = int(os.getenv("RETRIEVER_ARANGO_FETCH_K", 20))
RETRIEVER_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_SCORE_THRESHOLD", 0.1))
RETRIEVER_DISTANCE_THRESHOLD = int(os.getenv("RETRIEVER_ARANGO_DISTANCE_THRESHOLD", 1))
RETRIEVER_TRAVERSAL_ENABLED = os.getenv("RETRIEVER_ARANGO_TRAVERSAL_ENABLED", "false")
RETRIEVER_TRAVERSAL_MAX_DEPTH = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH", 2))
RETRIEVER_TRAVERSAL_MAX_RETURNED = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED", 3))
RETRIEVER_TRAVERSAL_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD", 0.5))
RETRIEVER_LAMBDA_MULT = float(os.getenv("RETRIEVER_ARANGO_LAMBDA_MULT", 0.5))

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "adaptive")  # slice | threshold | knee_threshold | adaptive
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 3))  # if RERANKING_STRATEGY set to 'slice'
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.9))  # if RERANKING_STRATEGY set to 'threshold'

DOC_REPO_URL = os.getenv("DOC_REPO_URL", "http://localhost:3001")  # Document repository URL
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")  # Backend service URL
# The language registry is the single source of the supported languages: each
# entry carries the canonical code, the display name and the script. It lives
# with the backend's language maps
# (components/gov-chat-backend/services/translation/language-maps/
# language-registry.json) and reaches this directory as a symlink in the
# source tree and a COPY in the image, so the two runtimes cannot list
# different languages. It is the whitelist every caller-supplied language is
# checked against, so it is resolved next to this module rather than against
# the working directory: a service started from another directory must not
# silently end up with an empty map (which would refuse every language).
LANGUAGE_REGISTRY_FILEPATH = os.getenv(
    "LANGUAGE_REGISTRY_FILEPATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "language-registry.json"),
)
# How long an unreadable language map is remembered as unreadable. The map is
# consulted on every request and on every translated chunk: re-reading (and
# re-logging) a broken file that often is noise, but caching the failure for
# the lifetime of the process would keep translation disabled after a transient
# read error.
LANGUAGE_MAP_RETRY_SECONDS = 60.0

# The language the chat history is normalized to before it reaches the
# retriever. The embedding space is English-only, so the history is
# translated into English whatever the caller asked for: the language a
# request asks for steers the ANSWER, never the history. The target is a
# constant rather than an argument of the translation helper, so the history
# cannot be steered into another language — neither by a caller nor by a
# later change to the call site.
HISTORY_TRANSLATION_TARGET = "en"

# The query-translation status vocabulary, unpacked from the one home in
# core.span_attrs so every site below names the same five values the span
# attribute, the response metadata and the runbook document.
_QUERY_TRANSLATED, _QUERY_PASSTHROUGH_EN, _QUERY_PASSTHROUGH_UNKNOWN, _QUERY_FALLBACK_TIMEOUT, _QUERY_FALLBACK_ERROR = (
    QUERY_TRANSLATION_STATUSES
)

# The script each language is written in (ISO 15924) comes from the same
# registry entry as its name. The translation prompt has to agree with the
# target: asking for the Latin alphabet of a language written in Devanagari
# makes the model answer in the wrong script.

# The script names the prompt uses. A script that is not listed is named by
# its code, which is still an unambiguous script tag.
_SCRIPT_NAMES = {
    "Latn": "Latin",
    "Arab": "Arabic",
    "Beng": "Bengali",
    "Cyrl": "Cyrillic",
    "Deva": "Devanagari",
    "Ethi": "Ethiopic",
    "Guru": "Gurmukhi",
    "Hans": "Han",
    "Hant": "Han",
    "Hang": "Hangul",
    "Jpan": "Japanese",
    "Mlym": "Malayalam",
    "Thai": "Thai",
}

# The shape a language code has to have before it is written into a prompt.
# A code that does not look like a code is not one: it is replaced by the
# default rather than carried into the prompt.
_LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}(-[a-z0-9]{2,8})?$")

# The longest a caller-supplied language may be. A code the language map
# carries is a few characters long, so a longer value is not a language: the
# bound keeps the lookup short whatever the caller sent. The backend applies
# the same bound, in the same order, to the value it forwards
# (components/gov-chat-backend/services/translation/language-request.js).
MAX_LANGUAGE_LENGTH = 32


def _canonical_language_code(raw_language, language_codes: dict) -> str | None:
    """The code a language map is keyed in, or None when it does not know it.

    A language map is keyed in lower case ("fr"), so this is the form a
    lookup needs. It is the one place that decides whether a caller-supplied
    value is a language at all: a value that is not a string, an empty one,
    "auto" (a request to detect the language, not a language) and a code the
    map does not know are all refused here rather than at each call site.
    """
    if not isinstance(raw_language, str):
        return None
    # The value is trimmed, then cut, then lower-cased: the trim comes first
    # so that a language the caller padded with spaces still names itself —
    # a language cut before it is trimmed is a language that disappears, and
    # the answer is then delivered in English without ever being refused.
    # The backend applies the same order to the value it forwards
    # (components/gov-chat-backend/services/translation/language-request.js).
    candidate = raw_language.strip()[:MAX_LANGUAGE_LENGTH].lower()
    if not candidate or candidate == "auto":
        return None
    if candidate not in language_codes:
        return None
    return candidate


def _canonical_target_language(iso_code, language_codes: dict) -> tuple[str | None, str | None]:
    """The canonical code and the language name a target code resolves to.

    A code the map does not know is refused: the answer is left untranslated
    rather than steered by a value the caller wrote. The refusal is decided
    here, so the path that translates a single chunk and the path that
    translates a document in chunks refuse in the same words.
    """
    canonical_code = _canonical_language_code(iso_code, language_codes)
    if canonical_code is None:
        logger.warning(
            f"Language code '{_language_display(iso_code)}' is not a known language code — "
            "refusing to translate and returning the source text."
        )
        return None, None
    return canonical_code, language_codes[canonical_code]


def _resolve_language_code(raw_language, language_codes: dict) -> str | None:
    """Canonical code for a caller-supplied language, or None when it is not one.

    The language travels in the request body, so it is caller-controlled: it
    used to be interpolated into the translation prompts as-is, which let a
    caller put free text ("fr. Ignore all previous instructions") where a
    language belongs. Only a code the language map knows is accepted here;
    everything else is refused, and the answer stays in English rather than
    letting the string steer the translator.

    The canonical form is upper case ("FR"), matching the auto-detected codes
    the rest of the service compares against ("EN").
    """
    canonical = _canonical_language_code(raw_language, language_codes)
    return canonical.upper() if canonical else None


def _language_display(raw_language) -> str:
    """A short, log-safe form of a caller-supplied language.

    The value is attacker-controlled, so it is cut to a bounded length and
    reduced to the characters a language name is made of: a log line must not
    become a channel for arbitrary text, nor for forged log lines through an
    embedded newline. The value is trimmed before it is cut, so a language
    the caller padded with spaces still names itself in the log. The backend
    applies the same rule to the value it logs
    (services/translation/language-log.js) — including the sentinel it uses
    for a value that is not a string at all, so a log query written against
    one service finds the lines of the other.
    """
    if not isinstance(raw_language, str):
        return "<non-string>"
    printable = "".join(char for char in raw_language.strip()[:MAX_LANGUAGE_LENGTH] if char.isalnum() or char in "_-")
    return printable or "<empty>"


# The language registry (code -> name + script), the moment it was read, and
# the two projections the prompts consume. Module level because the
# prompt-building hooks have no access to the service instance. One read
# fills all three, so the name and the script of a language can never come
# from two different generations of the file, and the projections are never
# rebuilt per call.
_LANGUAGE_REGISTRY_CACHE: dict | None = None
_LANGUAGE_REGISTRY_CACHE_AT: float | None = None
_LANGUAGE_CODES_CACHE: dict | None = None
_LANGUAGE_SCRIPTS_CACHE: dict | None = None


def _read_language_registry(filepath: str) -> dict:
    """Read the languages of the registry from disk. An unreadable registry
    reads as empty.

    The registry is a whitelist of language codes, so a file that holds
    something else is not a registry: a list of two-letter strings reads as
    {"e": "n", ...}, and the flat code-to-name map this registry replaced
    answers every script lookup with a string. Both would be accepted as
    languages nobody configured, so a file whose entries do not each carry a
    non-empty name and a non-empty script is treated as unreadable. An empty
    registry is unreadable too: it refuses every language without saying why.
    """
    try:
        with open(filepath, encoding="utf-8") as file:
            loaded = json.load(file)
    except Exception as e:
        logger.error(f"Error loading the language registry from {filepath}: {e}")
        return {}
    languages = loaded.get("languages") if isinstance(loaded, dict) else None
    if not isinstance(languages, dict) or not all(
        isinstance(code, str)
        and isinstance(entry, dict)
        and isinstance(entry.get("name"), str)
        and entry["name"]
        and isinstance(entry.get("script"), str)
        and entry["script"]
        for code, entry in languages.items()
    ):
        logger.error(f"The language registry file {filepath} is not a map of named, scripted languages — ignoring it.")
        return {}
    if not languages:
        logger.error(f"The language registry file {filepath} is empty — ignoring it.")
        return {}
    return languages


def _load_language_registry() -> None:
    """Fill the registry cache and its two projections, at most once per
    retry window.

    The maps are consulted on every request and again for every translated
    chunk, so reading and parsing the file each time is pure overhead. A
    registry that could not be read is remembered only for
    LANGUAGE_MAP_RETRY_SECONDS: a transient read failure must not disable
    translation for the lifetime of the process, but it must not re-read
    (and re-log) the file on every chunk either. An unreadable registry
    fills every cache as empty — an empty map means every language is
    unknown, and an empty script table means the prompt carries no script
    clause rather than a wrong one.

    The retry read is a blocking read of a small file, at most once a minute,
    and only for as long as the file stays unreadable.
    """
    global _LANGUAGE_REGISTRY_CACHE, _LANGUAGE_REGISTRY_CACHE_AT
    global _LANGUAGE_CODES_CACHE, _LANGUAGE_SCRIPTS_CACHE

    if _LANGUAGE_REGISTRY_CACHE:
        return
    now = time.monotonic()
    if _LANGUAGE_REGISTRY_CACHE_AT is not None and now - _LANGUAGE_REGISTRY_CACHE_AT < LANGUAGE_MAP_RETRY_SECONDS:
        # The last read failed and the retry window has not elapsed yet.
        return
    loaded = _read_language_registry(LANGUAGE_REGISTRY_FILEPATH)
    # The projections are published before the guard and the timestamp that
    # send readers away: a reader that takes the early return must never
    # still see them unset.
    _LANGUAGE_CODES_CACHE = {code: language["name"] for code, language in loaded.items()}
    _LANGUAGE_SCRIPTS_CACHE = {code: language["script"] for code, language in loaded.items()}
    _LANGUAGE_REGISTRY_CACHE_AT = now
    _LANGUAGE_REGISTRY_CACHE = loaded


def language_codes_map() -> dict:
    """The language map (code → name), read once and cached.

    The map is never None: an unreadable registry is an empty map, and an
    empty map means every language is unknown.

    The returned map is a copy. The cache is the whitelist every request is
    checked against, and a caller that mutated the map it got back would
    rewrite that whitelist for the whole process.
    """
    _load_language_registry()
    return dict(_LANGUAGE_CODES_CACHE)


def language_scripts_map() -> dict:
    """The language -> script table, read once and cached.

    The table decides whether the translation prompt asks for the right
    ALPHABET. It is never None: an unreadable registry is an empty table,
    and an empty table means the prompt carries no script clause rather than
    a wrong one.

    The returned table is a copy, like the language map: a caller that
    mutated it would change the script every later prompt asks for.
    """
    _load_language_registry()
    return dict(_LANGUAGE_SCRIPTS_CACHE)


# Fallback context window for the LLM, used when runtime discovery from the
# vLLM /v1/models payload fails (endpoint unreachable, or it does not expose
# max_model_len). Sized for the project-standard Granite model; deployments
# serving smaller models behind a non-vLLM backend should set the env var.
# See _get_max_model_len().
MAX_MODEL_LEN_TEXTGEN = _env_int("MAX_MODEL_LEN_TEXTGEN", 65536)

# Answer-token cap used when the request does not specify max_tokens. Kept
# independent of the discovered context window: a big window must not invite
# unbounded generations — it only widens the history budget.
DEFAULT_MAX_ANSWER_TOKENS = 3896

# Fallback character budget for history sent to translation, used when runtime
# discovery of the translation model's window fails. See
# _get_max_translation_chars().
MAX_TRANSLATION_CHARS = _env_int("MAX_TRANSLATION_CHARS", 2000)
USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)


def _extract_history_text(translated_history_string, n_turns):
    """Return the previous N turns from the pipe-delimited history blob.

    The blob format is "ROLE: content |<-MSG->| ROLE: content |<-MSG->| ...",
    the same string handle_request builds (English-normalized for non-EN
    conversations so it matches the bge-large-en-v1.5 embedding space). The last
    segment is the current user turn (already extracted as the query via
    USER_MSG_PATTERN); everything before it is history. We return the last
    `n_turns` prior segments joined into one string for a single embedding call.

    Returns "" on empty input, first turn (no prior history), or n_turns<=0.
    """
    prior = _prior_history_segments(translated_history_string)
    if not prior or n_turns <= 0:
        return ""
    return " ".join(prior[-n_turns:])


def _prior_history_segments(translated_history_string):
    """Return the history segments preceding the current user turn.

    The current turn is the query (already extracted via USER_MSG_PATTERN), so
    only what comes before it is blendable history. Empty when the blob is
    empty or holds a single turn.
    """
    if not translated_history_string:
        return []
    segments = [s.strip() for s in translated_history_string.split("|<-MSG->|") if s.strip()]
    if len(segments) < 2:
        return []
    return segments[:-1]


def _blend_embeddings(query_emb, history_emb, alpha):
    """V = α·EQ + (1-α)·EH, elementwise.

    Alpha is clamped to [0,1]. Returns query_emb unchanged when history_emb is
    empty or dimensions mismatch (defensive — never raises).
    """
    if not history_emb or len(query_emb) != len(history_emb):
        return query_emb
    a = max(0.0, min(1.0, float(alpha)))
    return [a * q + (1.0 - a) * h for q, h in zip(query_emb, history_emb, strict=False)]


# Condense-question rewrite (issue #1091). The rewrite call shares the chat
# LLM's endpoint/model and is fail-closed: any failure classification below
# fails the turn with LLM-failure semantics (503) — no blend or raw-query
# fallback. Product stance: a wrong answer is worse than a failed turn.
# Built-in default; MULTI_TURN_CONDENSE_SYSTEM_PROMPT overrides it per call
# (two-tier priority, same contract as CHATQNA_SYSTEM_PROMPT). A custom prompt
# must still demand JSON-only output — the response is parsed as
# {"standalone_query": "..."} and anything else fails the turn (bad_body).
_CONDENSE_SYSTEM_PROMPT = (
    "You rewrite a user's follow-up message into a standalone information-retrieval "
    "query. Resolve pronouns and implicit references using the chat history. "
    "EXCLUDE anything the user rejects. Output JSON only: "
    '{"standalone_query": "..."}'
)
# Env-tunable (MULTI_TURN_CONDENSE_MAX_TOKENS / MULTI_TURN_CONDENSE_TIMEOUT_SECONDS).
# The token cap must clear the longest valid rewrite: a guided-JSON output cut
# mid-string parses as bad_body and fails the turn (503). 256 = ~4x the worst
# observed rewrite (a multi-clause follow-up, ~60 tokens); only consumed tokens
# cost anything, and a runaway generation is still bounded by the timeout.
_CONDENSE_MAX_TOKENS = _env_int("MULTI_TURN_CONDENSE_MAX_TOKENS", 256)
_CONDENSE_TIMEOUT_SECONDS = _env_float("MULTI_TURN_CONDENSE_TIMEOUT_SECONDS", 5.0)


class CondenseError(Exception):
    """Condense-rewrite failure, classified for the 503 envelope.

    reason: timeout | http_error | bad_body | missing_field | empty_query
    """

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail[:200]}")
        self.reason = reason


def _build_condense_user_content(history_text: str, last_message: str) -> str:
    """Condense user content: history window, then the latest message."""
    return f"CHAT HISTORY:\n{history_text}\n\nLATEST MESSAGE:\n{last_message}\n\nStandalone query:"


def _parse_condense_response(content) -> str:
    """Extract the standalone query from the condense LLM's JSON output.

    Raises CondenseError for every malformed shape (fail-closed, issue #1091):
    missing_field (non-string content), bad_body (unparseable JSON),
    empty_query (missing/blank standalone_query).
    """
    if not isinstance(content, str):
        raise CondenseError("missing_field", f"content is {type(content).__name__}")
    stripped = content.strip()
    # response_format json_object makes fences rare, but a fenced reply must
    # not fail a legitimate turn. Strip both single-line (`` ```json{...}``` ``)
    # and multi-line (`` ```json\\n{...}\\n``` ``) variants robustly. The
    # opening fence is `` ``` `` followed by an optional language tag (e.g.
    # ``json``); the tag ends at the first newline (multi-line) or at the
    # first non-tag character (single-line).
    if stripped.startswith("```"):
        # Multi-line path: the language tag (if any) sits between `` ``` ``
        # and the first newline. Drop everything up to and including that
        # newline.
        if "\n" in stripped:
            stripped = stripped.split("\n", 1)[1]
        else:
            # Single-line path: `` ```json{...}``` `` — drop `` ``` `` plus
            # the optional alphanumeric language tag. ``[A-Za-z0-9]*`` is
            # greedy but bounded to the tag charset (no spaces), so it stops
            # at the first non-tag character (the JSON body).
            stripped = re.sub(r"^```[A-Za-z0-9]*", "", stripped, count=1)
        # Drop the closing fence: keep everything up to the LAST `` ``` ``
        # run in the body (rsplit handles both ``\\n``` `` and inline
        # ``}``` `` identically).
        stripped = stripped.rsplit("```", 1)[0].strip()
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as e:
        raise CondenseError("bad_body", f"invalid JSON: {str(e)[:120]}") from e
    query = payload.get("standalone_query") if isinstance(payload, dict) else None
    if not isinstance(query, str) or not query.strip():
        raise CondenseError("empty_query", f"standalone_query missing/blank: {stripped[:120]}")
    return query.strip()


def _resolved_blend_settings(translated_history_string):
    """Resolve the multi-turn blend configuration for ONE request.

    Returns (enabled, alpha, history_turns). `alpha` and `history_turns` are
    what this request actually blends, not the module defaults: the configured
    turn count is only an upper bound, and a first-turn conversation feeds the
    blend nothing at all. A span reporting the configuration verbatim would
    misreport every request the conversation shape differs from.
    """
    if not (MULTI_TURN_BLEND_ENABLED and MULTI_TURN_HISTORY_TURNS > 0):
        return False, None, 0
    fed = _prior_history_segments(translated_history_string)[-MULTI_TURN_HISTORY_TURNS:]
    if not fed:
        return True, None, 0
    return True, MULTI_TURN_BLEND_ALPHA, len(fed)


def _resolve_answer_budget_tokens(max_tokens) -> int:
    """Return the answer reserve the context-budget guard reserves.

    A request that omits max_tokens falls back to DEFAULT_MAX_ANSWER_TOKENS,
    so both the span attribute and the truncation event must read the reserve
    through this helper — two derivations would disagree in exactly the
    default configuration.
    """
    return int(max_tokens or DEFAULT_MAX_ANSWER_TOKENS)


def _blend_attributes(enabled: bool, alpha, history_turns: int) -> dict:
    """Multi-turn blend attributes for the chatqna.orchestrate span.

    `alpha` is emitted only when a blend actually ran: with no history fed
    there is no blend weight in play, and omitting beats reporting a number
    the request never used.
    """
    attrs = {
        ATTRIBUTE_NAMES["rag_blend_enabled"]: bool(enabled),
        ATTRIBUTE_NAMES["rag_blend_history_turns"]: int(history_turns or 0),
    }
    if enabled and alpha is not None:
        attrs[ATTRIBUTE_NAMES["rag_blend_alpha"]] = float(alpha)
    return attrs


def _prompt_budget_attributes(window_tokens, answer_budget_tokens, estimate) -> dict:
    """Prompt-budget attributes for the chatqna.orchestrate span.

    Absent values are omitted rather than nulled: a null teaches the reader
    nothing and satisfies a naive assertion perfectly.
    """
    attrs = {}
    if window_tokens is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_window_tokens"]] = int(window_tokens)
    if answer_budget_tokens is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_answer_budget_tokens"]] = int(answer_budget_tokens)
    if estimate is not None:
        attrs[ATTRIBUTE_NAMES["rag_prompt_tokens_estimate"]] = int(estimate)
    return attrs


def _emit_budget_truncation_event(
    current_span, dropped_segments, window_tokens, answer_budget_tokens, max_history_tokens
) -> None:
    """Record that the context-budget guard dropped history segments.

    A no-op when nothing was dropped, so the presence of the event always means
    "truncation happened" rather than "the guard ran".
    """
    if not dropped_segments:
        return
    if current_span is None or not current_span.is_recording():
        return
    current_span.add_event(
        "context_budget.truncated",
        {
            "dropped_segments": int(dropped_segments),
            "window_tokens": int(window_tokens or 0),
            "answer_budget_tokens": int(answer_budget_tokens or 0),
            "max_history_tokens": int(max_history_tokens or 0),
        },
    )


def _set_attributes(span, attributes: dict) -> None:
    """Write a prepared attribute dict onto a span that is recording."""
    if span is None or not span.is_recording():
        return
    for key, value in attributes.items():
        span.set_attribute(key, value)


# ---------------------------------------------------------------------------
# Stripping of leaked conversation markers (shared by streaming + non-streaming).
#
# The LLM sometimes echoes back the internal |<-MSG->| delimiters and
# USER:/ASSISTANT: role markers used to format chat history in the prompt. Both
# the assembled-response path (handle_request) and the streaming path
# (_stream_with_metadata) must strip them, so the patterns below are defined
# once and consumed by both — there is a single source of truth for what a
# "conversation marker" looks like.
#
# In the streaming path a marker may arrive split across token chunks (e.g.
# "|<-M" then "SG->|"), so content is buffered: only the settled head is emitted
# and a tail that could be the start of a marker is held back until the marker
# either completes (and is stripped) or enough non-marker text arrives to prove
# it is real content.
# ---------------------------------------------------------------------------
_CONV_MSG_SEPARATOR = "|<-MSG->|"
# Separator with surrounding whitespace collapsed to a single newline.
_CONV_SEP_RE = re.compile(r"\s*\|<-MSG->\|\s*")
# Role marker at line start, tolerating leading whitespace so a marker split
# from its preceding separator across chunks (separator -> "\n" in one chunk,
# " USER:" arriving in the next) is still stripped.
_CONV_ROLE_RE = re.compile(r"^[ \t]*(?:USER|ASSISTANT):\s*", re.MULTILINE)
# Marker literals whose partial occurrence at the streaming buffer tail must be
# withheld so a split marker is never emitted as literal text.
_CONV_MARKER_PREFIXES = (_CONV_MSG_SEPARATOR, "USER:", "ASSISTANT:")
# Cap on how much trailing whitespace is withheld as a candidate lead-in
# (the ``\s*`` / ``[ \t]*`` before a marker). In practice that lead-in is only a
# few characters; capping bounds memory and regex cost if a misbehaving upstream
# emits a very long run of whitespace (the excess is flushed as plain content,
# which only costs a few cosmetic trailing spaces before the next newline).
_MAX_TRAILING_WS_WITHHOLD = 32
# Collapse runs of 3+ newlines down to a single paragraph break (\\n\\n).
# Granit's chat-tuned markdown style tends to emit 3+ newlines between
# sections (header → list, list → next header), which renders as extra
# visual blank lines in the chat. A single markdown paragraph only needs
# one blank line to separate it from the next; anything beyond that is
# cosmetic noise from the model's formatting style and gets squashed here
# so the user sees clean, compact markdown.
_EXCESS_BLANK_RE = re.compile(r"\n{3,}")


def _is_usage_only_frame(content: str) -> bool:
    """True when a decoded token chunk is vLLM's terminal usage-only frame.

    The OpenAI streaming wire ends generation with a chunk carrying
    ``"choices": []`` and the token ``usage`` — no content. The orchestrator's
    ``align_generator`` forwards it like any token, so without this check the
    raw JSON (``{"id":"chatcmpl-…","usage":{…}}``) leaks into the user-visible
    answer text (live 2026-10-23: pasted into chat responses AND into
    benchmark answers, where the judge scores it as answer content).

    A legitimate answer token never parses as a JSON object with a ``usage``
    key and empty/absent ``choices``.

    This is the CONSUMER-side guard. The producer-side router
    (``_stream_answer_text``) already drops such frames in the streamed
    path, but the NON-streaming path assembles the raw chunk text and can
    still carry one, so both ends need a check.
    """
    stripped = content.strip()
    if not (stripped.startswith("{") and stripped.endswith("}")):
        return False
    try:
        obj = json.loads(stripped)
    except (ValueError, TypeError):
        return False
    # The REAL terminal frame is exact: `"choices": []` present-and-empty, and
    # `usage` an OBJECT of token counts. The old shape check ("usage" merely
    # PRESENT, choices merely falsy) swallowed legitimate answers — a model
    # asked for JSON can return {"usage": "5 kWh", ...}: a usage STRING with
    # no choices key at all (review 2026-10-29).
    # That tightening stays — the usage STRING case is still answer content —
    # but some vLLM builds end the stream with a keyless frame: a usage OBJECT
    # and NO ``choices`` key at all. That shape is transport metadata too
    # (review 2026-10-29 round 3), so it is recognized alongside the
    # choices==[] frame; any PRESENT choices key must still be exactly [].
    return (
        isinstance(obj, dict)
        and isinstance(obj.get("usage"), dict)
        and (obj.get("choices") == [] or "choices" not in obj)
    )


def _stream_answer_text(json_data: object) -> str | None:
    """The text a parsed LLM stream frame contributes to the answer, or None
    when the frame is well-formed transport metadata: the terminal usage-only
    frame, the finish_reason chunk, a keepalive, a tool-call delta with no
    text.

    Raises only on frames too malformed to route at all (a non-object
    payload, a malformed ops payload); the streaming loop turns that into
    the warning tier. Content that arrives as OpenAI content parts
    (``[{"type": "text", "text": ...}]``) is joined into one string.
    """
    if not isinstance(json_data, dict):
        raise ValueError(f"non-object stream frame: {type(json_data).__name__}")
    if "ops" in json_data:
        first = json_data["ops"][0] if isinstance(json_data["ops"][0], dict) else {}
        value = first.get("value")
        return value if isinstance(value, str) else None
    choices = json_data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0] if isinstance(choices[0], dict) else {}
    delta = first.get("delta")
    if not isinstance(delta, dict):
        return None
    content = delta.get("content")
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content if isinstance(content, str) else None


def _streaming_marker_tail_len(buffer: str) -> int:
    """Length of the longest buffer suffix that could grow into a marker.

    A marker (``|<-MSG->|``, ``USER:``, ``ASSISTANT:``) may arrive split across
    token chunks. This returns the size of the trailing slice that must stay
    buffered so a partial marker is never emitted as literal text. Trailing
    whitespace is included because it can be the ``\\s*`` that precedes a
    separator or the ``[ \\t]*`` that precedes a role marker.
    """
    n = len(buffer)
    if n == 0:
        return 0
    best = 0
    # Trailing whitespace: candidate lead-in (\s* / [ \t]*) for the next marker.
    # Capped so a pathological long-whitespace run cannot grow the buffer
    # unboundedly (the cap-flushed excess becomes plain content).
    trailing_ws = n - len(buffer.rstrip())
    if trailing_ws:
        best = min(trailing_ws, _MAX_TRAILING_WS_WITHHOLD)
    # Longest tail of the buffer that could grow into a marker literal (withhold it
    # so a split marker never leaks as literal text). Conversation markers never
    # appear here in full (they are regex-substituted before this check), but the
    # `[[CONF:` sentinel prefix has no bare-form substitute — only the COMPLETE
    # `[[CONF:<n>]]` is extracted — so when the tokenizer emits `[[CONF:` as a chunk
    # boundary the full prefix sits at the tail and must ALSO be withheld, or it
    # leaks and the value is never captured. Allow the full marker length.
    markers = (
        _CONV_MARKER_PREFIXES + (_SELF_CONF_SENTINEL_PREFIX,) if LLM_SELF_CONFIDENCE_ENABLED else _CONV_MARKER_PREFIXES
    )
    for marker in markers:
        limit = min(n, len(marker))
        for k in range(limit, 0, -1):
            if marker.startswith(buffer[-k:]):
                if k > best:
                    best = k
                break
    return best


# ---------------------------------------------------------------------------
# Confidence scoring
#
# The user-facing confidence is a *rank-weighted* aggregate of calibrated
# reranker scores, not the flat mean used initially. Two orthogonal knobs:
#   - calibration (`RERANKER_SCORE_CALIBRATION`): map raw reranker logits onto an
#     interpretable [0,1] scale. Default `none` — enable `sigmoid` only after
#     verifying the TEI/model output is raw logits, otherwise this *compresses*
#     scores (0.95 -> 0.72) and worsens the symptom.
#   - rank decay (`CONFIDENCE_RANK_DECAY`): exponential weight decay per rank so
#     the most relevant document dominates the aggregate.
# An optional LLM self-grade (`LLM_SELF_CONFIDENCE_ENABLED`, default off) lets the
# model rate how well the retrieved documents support its own answer; it is
# exposed alongside the retrieval confidence but never replaces the grounding
# decision, which stays driven by `is_grounded`. See site/content/en/docs/architecture/architecture.md §9.4.
# ---------------------------------------------------------------------------

RERANKER_SCORE_CALIBRATION = os.getenv("RERANKER_SCORE_CALIBRATION", "none").strip().lower()
RERANKER_SCORE_TEMPERATURE = float(os.getenv("RERANKER_SCORE_TEMPERATURE", "1.0") or "1.0")
CONFIDENCE_RANK_DECAY = float(os.getenv("CONFIDENCE_RANK_DECAY", "0.5") or "0.5")
# Opt-in: when on, the model appends a `[[CONF:<0-100>]]` self-grade sentinel and
# we expose it as `self_confidence`. Off by default — surface to users only after
# the eval harness (see research doc) confirms it is calibrated.
LLM_SELF_CONFIDENCE_ENABLED = os.getenv("LLM_SELF_CONFIDENCE_ENABLED", "0").strip() in (
    "1",
    "true",
    "yes",
    "on",
)


def _calibrate_reranker_score(score: float) -> float:
    """Map a raw reranker score onto an interpretable [0,1] scale.

    Cross-encoder rerankers (incl. ``bge-reranker-v2-m3``) emit relevance *logits*
    whose absolute values are not calibrated probabilities. ``sigmoid`` maps them
    to [0,1]; ``none`` (default) leaves the score untouched for deployments where
    the model or TEI already returns normalised scores — applying sigmoid there
    would compress values (0.95 -> 0.72) and *worsen* the symptom. Operators must
    verify the TEI output range before enabling ``sigmoid``.
    """
    try:
        score = float(score)
    except (TypeError, ValueError):
        # Non-numeric score (should not occur — reranker scores are numeric);
        # treat as no signal rather than crashing the chat.
        return 0.0
    if RERANKER_SCORE_CALIBRATION != "sigmoid":
        return score
    temperature = RERANKER_SCORE_TEMPERATURE or 1.0
    try:
        return 1.0 / (1.0 + math.exp(-score / temperature))
    except OverflowError:
        # Extreme logits (possible from cross-encers on out-of-distribution
        # inputs, or a low operator-configured temperature) would overflow
        # math.exp; saturate to the asymptote instead of crashing the chat.
        return 0.0 if score < 0 else 1.0


def _rank_weighted_confidence(scores: list[float]) -> float:
    """Exponential rank-decay weighted average of reranker scores.

    ``scores`` is in the reranker's descending display order, so rank 0 is the
    most relevant document. Exponential decay (``CONFIDENCE_RANK_DECAY``) lets the
    strongest match dominate, so a long tail of low-scoring chunks kept by the
    adaptive strategy for novelty no longer depresses the score. Returns 0.0 for
    an empty list (ungrounded).
    """
    if not scores:
        return 0.0
    # Allow 0 (equal weighting = flat mean); only fall back for an invalid negative.
    decay = CONFIDENCE_RANK_DECAY if CONFIDENCE_RANK_DECAY >= 0 else 0.5
    weights = [math.exp(-decay * i) for i in range(len(scores))]
    return sum(w * s for w, s in zip(weights, scores, strict=True)) / sum(weights)


def _display_confidence(retrieval_confidence: float, self_confidence: float | None) -> float:
    """Citizen-facing confidence value.

    When the LLM self-grade feature is on, the model's self-assessed groundedness is
    surfaced to clients via the existing ``confidence_score`` field (transparent — no
    client change). Falls back to the retrieval confidence when the model omitted the
    sentinel, so the badge never disappears. The raw retrieval and self values are
    emitted separately (``retrieval_confidence_score`` / ``self_confidence``) for
    admin/eval.
    """
    return self_confidence if self_confidence is not None else retrieval_confidence


# LLM self-grade sentinel: when LLM_SELF_CONFIDENCE_ENABLED, the model ends its
# reply with `[[CONF:<0-100>]]`. We strip it before the text reaches the user or
# the translation pipeline, and expose its value as `self_confidence`.
# Terminal-only: the sentinel is the model's final line, so anchor to end-of-text.
# This also prevents an inline `[[CONF:N]]` that is real answer content from being
# stripped (a misplaced/earlier sentinel is left untouched rather than corrupting
# the answer). `\s*$` tolerates trailing whitespace/newlines from the orchestrator.
_SELF_CONF_SENTINEL_RE = re.compile(r"\[\[CONF:\s*(\d{1,3})\s*\]\]\s*$")
_SELF_CONF_SENTINEL_PREFIX = "[[CONF:"
# Trailing PARTIAL sentinel: an in-progress `[[CONF:<digits>]]` that has not yet
# completed (digits / closing brackets still arriving). Used (a) in the streaming
# loop to withhold such a tail so it never leaks mid-stream, and (b) on the final
# flush to drop any malformed/incomplete marker. Allows `]` (closing brackets are
# part of the partial); disallows `[` so a new marker can't be swallowed.
_SELF_CONF_PARTIAL_RE = re.compile(r"\s*\[\[CONF:[^\[]*$")


def _find_node_key(result_dict: dict, prefix: str) -> str | None:
    """The first key in ``result_dict`` starting with ``prefix``, or None.

    The one locator for orchestrator node outputs; the service method of the
    same name delegates here so callers inside and outside the class share
    the same first-match rule.
    """
    for key in result_dict or {}:
        if key.startswith(prefix):
            return key
    return None


def _node_docs(result_dict: dict, prefix: str) -> list | None:
    """The ``retrieved_docs`` of the first node whose key starts with
    ``prefix``, or None when that node's output does not carry the key.

    One accessor per node kind, so the grounding decision and the abstention
    flag cannot read the same node by different rules. Node outputs are dicts
    shaped like ``{"retrieved_docs": [...]}``; None means "the node cannot
    say" — a malformed or error-shaped result, which is a fault, not a
    selection that kept nothing.
    """
    key = _find_node_key(result_dict, prefix)
    if key is None:
        return None
    val = (result_dict or {})[key]
    if isinstance(val, dict):
        return val.get("retrieved_docs")
    return getattr(val, "retrieved_docs", None)


def _abstention_outcome(result_dict: dict) -> tuple[bool, str | None]:
    """Whether the turn had no document backing, and its machine-readable cause.

    Two distinct no-document paths hand the LLM the abstention instructions
    (align_outputs adds them whenever its document list is empty): the
    retriever matched nothing inside the requested scope, or the reranker
    rejected every document the retriever DID match. Both are abstentions;
    the reason keeps the causes apart so an operator can tell a scope that
    retrieved nothing from a reranker that kept nothing.

    A node output without the expected key is a malformed or error-shaped
    result, not a selection that kept nothing: claim no abstention about it
    (the grounding decision makes the same conservative call).
    """
    if not _abstention_enforced():
        # The abstention instructions never reached the prompt, so the turn
        # was never set up to abstain: the flag keeps its established meaning
        # ("the turn abstained") rather than reporting intent.
        return False, None
    docs = _node_docs(result_dict, "retriever")
    if docs is None:
        return False, None
    if not docs:
        return True, "no_documents_retrieved"
    reranked = _node_docs(result_dict, "rerank")
    if reranked is not None and not reranked:
        return True, "reranker_selected_nothing"
    return False, None


def _mark_abstention(metadata: dict, reason: str) -> None:
    """Mark a metadata payload as abstained, with its machine-readable cause."""
    metadata["abstained"] = True
    metadata["abstention_reason"] = reason


def _count_final_chunks(result_dict: dict) -> int:
    """Count the chunks actually fed to the LLM from the orchestrator result.

    Node outputs are dicts shaped like ``{"retrieved_docs": [...]}``; iterate all
    nodes and keep the deepest stage's count (the reranker, after slicing) so the
    metric reflects the final chunk set, not an earlier pipeline stage. Returns 0
    when no node exposes retrieved_docs.
    """
    chunk_count = 0
    for val in (result_dict or {}).values():
        docs = val.get("retrieved_docs") if isinstance(val, dict) else getattr(val, "retrieved_docs", None)
        if docs:
            chunk_count = len(docs)
    return chunk_count


def _extract_self_confidence(text: str) -> tuple[str, float | None]:
    """Strip a trailing LLM self-grade sentinel, returning (clean_text, value).

    The model ends its reply (when ``LLM_SELF_CONFIDENCE_ENABLED``) with
    ``[[CONF:<0-100>]]`` rating how well the retrieved documents support it. This
    removes the marker so it never reaches the user or the translation pipeline
    and returns its value normalised to [0,1]. A missing, malformed, or
    out-of-range sentinel yields ``None``; this never raises.
    """
    if not text:
        return text, None
    match = _SELF_CONF_SENTINEL_RE.search(text)
    if not match:
        return text, None
    try:
        raw = int(match.group(1))
    except (TypeError, ValueError):
        return text, None
    if not 0 <= raw <= 100:
        return text, None
    cleaned = (text[: match.start()] + text[match.end() :]).rstrip()
    return cleaned, raw / 100.0


_CHATQNA_SELF_CONF_INSTRUCTION = (
    "\n\n---\nCRITICAL: You MUST end EVERY reply with a final line containing "
    "EXACTLY `[[CONF:<0-100>]]` (nothing after it). The number rates how well the "
    "Retrieved Documents support your reply (100 = fully grounded, 0 = not).\n"
    "Example:\n"
    "User: What soil for cucumber?\n"
    "Assistant: Cucumber grows best in well-drained sandy loam (pH 5.5-6.8).\n"
    "[[CONF:90]]\n"
    "---"
)


# Two-tier priority: ENV VAR (override) > Hardcoded default
_CHATQNA_SYSTEM_DEFAULT = """You are a friendly and polite information assistant.

Your task is to answer the user's latest question using only the content provided from the knowledge base.

**Instructions:**
- Do not invent or assume information
- If the answer is not in the provided content, inform the user that the information is unavailable
- Use the user's name, gender, age, preferences, and chat history to tailor and personalise your responses
- Keep answers informative but concise; provide detailed explanations
  only when necessary or explicitly requested

In line with the above instructions, generate a reply to the user's latest
message in the chat history based on the relevant content provided."""
_CHATQNA_SYSTEM_PROMPT_BASE = os.getenv("CHATQNA_SYSTEM_PROMPT", "").strip() or _CHATQNA_SYSTEM_DEFAULT
# When the LLM self-grade is enabled, instruct the model to emit the confidence
# sentinel. Additive and inert while LLM_SELF_CONFIDENCE_ENABLED is off.
CHATQNA_SYSTEM_PROMPT = _CHATQNA_SYSTEM_PROMPT_BASE + (
    _CHATQNA_SELF_CONF_INSTRUCTION if LLM_SELF_CONFIDENCE_ENABLED else ""
)
CHATQNA_ENFORCE_ABSTENTION = os.getenv("CHATQNA_ENFORCE_ABSTENTION", "") or "true"


def _abstention_enforced() -> bool:
    """Whether a turn with no context is instructed to abstain.

    The same predicate decides whether the abstention instructions reach the
    prompt, so the flag that reports an abstention follows the same switch:
    a deployment that turned the guardrail off answers instead of abstaining,
    and the flag stays unset.
    """
    return str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true"


CHATQNA_ABSTENTION_INSTRUCTIONS = os.getenv("CHATQNA_ABSTENTION_INSTRUCTIONS", "").strip() or None
# Default fallback when CHATQNA_ABSTENTION_INSTRUCTIONS is unset: instruct
# the LLM to still surface partial KB content while disclosing the
# ungrounded origin of any training-data fill-in.
_DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS = (
    "\n[No Relevant Documents Found] The knowledge base search did not "
    "return any high-confidence documents. You may still generate a "
    "response, but begin by clearly stating that you do not have sufficient "
    "information from verified source documents and that your response is "
    "based on general AI training data rather than the knowledge base.\n"
)
SENSITIVE_KEYS = set(os.getenv("SENSITIVE_KEYS", "").split(","))


def _gp(kwargs: dict, key: str, default=None):
    """Extract a GENIE param from ``kwargs`` with bundled-dict preference.

    The orchestrator's ``schedule()`` call forwards all six custom kwargs as a
    single ``genie_params`` dict (v1.5 re-graft). Handlers (align_inputs /
    align_outputs) receive this dict via ``**kwargs``. This helper looks up
    ``key`` inside ``kwargs["genie_params"]`` first; when the dict is absent
    (legacy flat-kwargs path), it falls back to ``kwargs[key]``.

    Args:
        kwargs: The ``**kwargs`` dict passed to an align handler.
        key: The parameter name to extract (e.g. ``"retriever_parameters"``).
        default: Value returned when neither path carries the key.

    Returns:
        The parameter value, or ``default`` if absent on both paths.
    """
    genie_params = kwargs.get("genie_params")
    if isinstance(genie_params, dict):
        return genie_params.get(key, default)
    return kwargs.get(key, default)


def _condense_raw_or(kwargs, default):
    """Return the condense-mode raw last message (issue #1091), or ``default``.

    ``condense_raw_query`` is the RAW last user message forwarded through
    ``genie_params`` in condense mode; the rewritten query is retrieval/rerank
    input only and must never enter the answer-LLM prompt. When the key is
    absent (default-blend / single-turn / condense-no-history skip), the
    caller's existing value is preserved bit-for-bit.
    """
    raw = _gp(kwargs, "condense_raw_query", None)
    return raw if raw is not None else default


def _condense_span_attrs(span, status, latency_ms):
    """Emit the three condense span attrs that go through ``sanitize_attributes``.

    Used by the ok path, the merged-failure path, and the no-history skip path.
    The two token counters (prompt_tokens / completion_tokens) intentionally
    bypass this helper — the PII regex in ``tracing._PII_KEY_PATTERNS`` would
    drop any key containing ``token``, and they carry no PII (integer counts
    only). The ok path keeps the raw ``span.set_attribute`` calls.
    """
    span.set_attributes(
        sanitize_attributes(
            {
                "genie.condense.mode": MULTI_TURN_MODE,
                "genie.condense.status": status,
                "genie.condense.latency_ms": latency_ms,
            }
        )
    )


def _raise_condense_503(reason, exc):
    """Raise the fail-closed condense envelope (issue #1091).

    Byte-identical to the pre-refactor on-the-wire response: a single
    ``{"error", "reason", "message"}`` dict under ``HTTPException(503).detail``.
    ``reason`` classifies the failure so callers / dashboards can tell
    timeout vs http_error vs parse apart.
    """
    raise HTTPException(
        status_code=503,
        detail={
            "error": "condense_failed",
            "reason": reason,
            "message": "Query rewriting failed; this turn cannot be answered reliably. Please retry.",
        },
    ) from exc


##################################################################################################################################
# CUSTOM DATA SUBCLASSES
##################################################################################################################################
class GenieaiRetrieverParms(RetrieverParms):
    enable_traversal: str = RETRIEVER_TRAVERSAL_ENABLED
    traversal_max_depth: int = RETRIEVER_TRAVERSAL_MAX_DEPTH
    traversal_max_returned: int = RETRIEVER_TRAVERSAL_MAX_RETURNED
    traversal_score_threshold: float = RETRIEVER_TRAVERSAL_SCORE_THRESHOLD


class GenieaiRerankerParms(RerankerParms):
    reranking_strategy: str = RERANKING_STRATEGY
    reranking_threshold: float = RERANKING_THRESHOLD


##################################################################################################################################
# HELPER CLASSES
##################################################################################################################################
class ChatTemplate:
    @staticmethod
    def generate_rag_prompt(question, documents):
        context_str = "\n".join(documents)
        if context_str and len(re.findall("[\u4e00-\u9fff]", context_str)) / len(context_str) >= 0.3:
            # chinese context
            template = """
### 你将扮演一个乐于助人、尊重他人并诚实的助手，你的目标是帮助用户解答问题。
### 有效地利用来自本地知识库的搜索结果。确保你的回答中只包含相关信息。
### 如果你不确定问题的答案，请避免分享不准确的信息。
### 搜索结果：{context}
### 问题：{question}
### 回答：
"""
        else:
            template = """
### You are a helpful, respectful and honest assistant to help the user with questions. \
Please refer to the search results obtained from the local knowledge base. \
But be careful to not incorporate the information that you think is not relevant to the question. \
If you don't know the answer to a question, please don't share false information. \n
### Search results: {context} \n
### Question: {question} \n
### Answer:
"""
        return template.format(context=context_str, question=question)


class GenieUserProfileClient:
    """
    Client for fetching User Profile data from the Backend Service.
    Designed to be used within the ChatQnA orchestrator.

    Auth: Bearer token propagated from the backend (JWKS-validated).
    """

    def __init__(self):
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")

    async def get_user_profile(self, token: str):
        """
        Fetches the sanitized user profile from the backend for context enrichment.
        Target: GET /api/me/context
        Auth: Bearer token (propagated from backend via Authorization header)

        Args:
            token (str): Bearer token forwarded on outbound calls.
        """
        if not token:
            logger.warning("get_user_profile called without token — caller must pass the validated Bearer token.")
            return None

        # Construct URL
        url = f"{BACKEND_SERVICE_URL}/api/me/context"

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            _timeout = aiohttp.ClientTimeout(
                total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
            )
            async with (
                aiohttp.ClientSession(timeout=_timeout) as session,
                session.get(url, headers=headers) as response,
            ):
                if response.status == 200:
                    profile_data = await response.json()
                    logger.info("Successfully retrieved user profile")
                    return profile_data

                elif response.status == 401:
                    logger.error("Bearer token rejected (401). Check token propagation.")
                    return None

                elif response.status == 404:
                    logger.warning("User profile not found")
                    return None

                else:
                    logger.error(
                        f"Failed to fetch user profile. Status: {response.status}, Body: {await response.text()}"
                    )
                    return None

        except Exception as e:
            logger.error(f"Error connecting to Backend Service for profile: {e}")
            return None


class UserContextBuilder:
    def _sanitize_data(self, data):
        if isinstance(data, dict):
            try:
                keys_to_remove = [k for k in data if k in SENSITIVE_KEYS]
            except Exception:
                logger.info(
                    "Attention: SENSITIVE_KEYS parameter is not defined. "
                    "Proceeding with default information masking instructions"
                )
                sensitive_keys = [
                    "email",
                    "phoneNumber",
                    "currentAddress",
                    "ipAddress",
                    "ssn",
                    "ssb",
                    "dob",
                    "credit_card",
                    "password",
                    "encPassword",
                    "salt",
                    "location",
                    "accessToken",
                    "refreshToken",
                    "_rev",
                    "_key",
                ]
                keys_to_remove = [k for k in data if k in sensitive_keys]

            for k in keys_to_remove:
                del data[k]

            for v in data.values():
                self._sanitize_data(v)

        elif isinstance(data, list):
            for item in data:
                self._sanitize_data(item)

        return data

    def _parse_dob(self, dob_str):
        """
        Supports:
        - YYYY-MM-DD
        - YYYY.MM.DD
        """
        if not isinstance(dob_str, str):
            return None

        dob_str = dob_str.strip()

        for fmt in ("%Y-%m-%d", "%Y.%m.%d"):
            try:
                return datetime.strptime(dob_str, fmt).date()
            except ValueError:
                continue

        return None

    def _calculate_age(self, birth_date):
        if not birth_date:
            return "N/A"

        today = date.today()
        return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))

    def _extract_primitive_fields(self, data, result=None):
        """
        Recursively extract primitive key/value pairs.
        If dict → recurse inside
        If list → extract primitives or recurse into dict items
        """
        accepted_value_types = (str, int, float, bool)

        if result is None:
            result = {}

        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, accepted_value_types):
                    result[k] = v

                elif isinstance(v, dict):
                    self._extract_primitive_fields(v, result)

                elif isinstance(v, list):
                    # If list of primitives → join into string
                    if all(isinstance(i, accepted_value_types) for i in v):
                        result[k] = ", ".join(map(str, v))
                    else:
                        for item in v:
                            self._extract_primitive_fields(item, result)

        elif isinstance(data, list):
            for item in data:
                self._extract_primitive_fields(item, result)

        return result

    def build_user_context_string(self, user_details):

        user_context_string = ""

        # Work on a copy (avoid mutating original payload)
        sanitized = self._sanitize_data(copy.deepcopy(user_details))

        # Extract primitives
        flat_fields = self._extract_primitive_fields(sanitized)

        # DoB > changed to age (less sensitive)
        age_value = None
        dob_keys = [k for k in flat_fields if k.lower() == "dob"]

        for dob_key in dob_keys:
            dob_raw = flat_fields.pop(dob_key)
            birth_date = self._parse_dob(dob_raw)
            age_value = self._calculate_age(birth_date)

        # Build output string
        lines = []

        for k, v in flat_fields.items():
            lines.append(f"- {k}: {v}")

        if age_value is not None:
            lines.append(f"- Age: {age_value}")

        if lines:
            user_context_string = "\n".join(lines) + "\n        ---\n"

        return user_context_string


##################################################################################################################################
# TOKEN COUNTING
##################################################################################################################################


@lru_cache(maxsize=4)
def _count_static_tokens(text: str) -> int:
    """Memoized ``_count_tokens`` for request-invariant text (the system
    prompt takes at most two values per process). A cache hit skips the HTTP
    round-trip entirely; the bounded size keeps it from growing."""
    return _count_tokens(text)


def _count_tokens(text: str) -> int:
    """Count tokens with the LLM server's ``/tokenize`` endpoint.

    The server that serves generation tokenizes with the deployed model's
    REAL tokenizer — the counts the context-window budget needs, for
    whatever model is deployed, with no local tokenizer download: the
    image bakes no HuggingFace cache and the deployment grants no
    huggingface.co egress, so a local ``AutoTokenizer`` can only fail.

    Same client shape as the model-id probe (core/model_http_policy.py:
    shared ``Bearer VLLM_API_KEY`` headers and TLS-verify flag): sync httpx,
    PROBE timeout budget. The URL derives from
    the same base the generation call and the probe use
    (``_LLM_DISCOVERY_ENDPOINT``), so external (``VLLM_LLM_ENDPOINT``,
    possibly a tunnel with a path prefix) and in-cluster
    (``http://vllm:8000``) resolve identically.

    Failures are loud and on purpose: the budget math below runs on these
    counts, so an unknown model name (vLLM validates it), an unreachable
    endpoint, or a malformed count payload must abort the request rather
    than silently corrupt the history truncation — the same reasoning that
    keeps the model-id probe from guessing.
    """
    url = f"{_LLM_DISCOVERY_ENDPOINT}/tokenize"
    headers = endpoint_auth_headers()
    verify = endpoint_verify()
    with with_span(
        "chatqna.count_tokens",
        attributes={ATTRIBUTE_NAMES["llm_endpoint"]: url},
    ) as span:
        resp = httpx.post(
            url,
            headers=headers,
            json={"model": _get_llm_model(), "prompt": text},
            timeout=PROBE_TIMEOUT_SECONDS,
            verify=verify,
        )
        resp.raise_for_status()
        payload = resp.json()
        # vLLM returns both the token list and a precomputed "count"; prefer
        # the scalar, fall back to the list length for servers that omit it.
        if not isinstance(payload, dict):
            raise TokenCountError(f"/tokenize returned a non-object payload: {payload!r}")
        count = payload.get("count")
        if count is None:
            tokens = payload.get("tokens")
            if not isinstance(tokens, list):
                raise TokenCountError(f"/tokenize payload has neither a count nor a token list: {payload!r}")
            count = len(tokens)
        else:
            # A proxy may serialize count as a digit string (same coercion
            # stance as the window value); anything non-integral is malformed.
            count = coerce_int(count)
            if count is None:
                raise TokenCountError(f"/tokenize count is not an integer: {payload!r}")
            if count < 0:
                # 0 is an honest count for an empty piece; a negative count is
                # a lie that would silently defeat the overflow guard.
                raise TokenCountError(f"/tokenize count is negative: {payload!r}")
            if count > MAX_SANE_MODEL_WINDOW_TOKENS:
                # Same sanity bound as the window value: a number this large is
                # a broken proxy, and it would wipe the history budget outright.
                raise TokenCountError(f"/tokenize count is absurdly large: {payload!r}")
        span.set_attribute(ATTRIBUTE_NAMES["token_count"], count)
        return count


##################################################################################################################################
# CHATQNA ORCHESTRATOR FUNCTIONS
##################################################################################################################################
def align_inputs(self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs):

    if self.services[cur_node].service_type == ServiceType.EMBEDDING:
        # Multi-turn vector-space blending (issue #833, E2 design): when a
        # history text is present, embed [query, history] as a SINGLE batched
        # TEI call instead of a side-channel httpx request. align_outputs
        # EMBEDDING then blends the two returned vectors. Empty/absent history
        # = single-input path (unchanged baseline behavior).
        _blend_history_text = inputs.pop("_blend_history_text", "")
        _blend_alpha = inputs.pop("_blend_alpha", None)
        # Issue #1035 (generalized): contrastive / instruction-tuned embedding
        # models require a query-side prefix at inference (per their model
        # card) to preserve the query/passage asymmetry. Apply only to queries
        # (and history strings, which act as queries for blending); passages
        # are encoded without the prefix by dataprep ingestion via the same
        # shared TEI service.
        #
        # Mirror the retriever's branch selection: when OpenAI embeddings are
        # active (OPENAI_API_KEY + OPENAI_EMBED_MODEL + OPENAI_EMBED_ENABLED),
        # the active embedding model is OPENAI_EMBED_MODEL — which has no
        # contrastive instruction entry. Without this gate, a deployment with
        # both OpenAI enabled AND TEI_EMBED_MODEL=BAAI/... would prefix the
        # query in chatqna (BAAI instruction → TEI microservice) while the
        # retriever's OpenAI branch encodes raw — silent dense-channel
        # mismatch on the embedding vector space.
        #
        # The retriever's BM25/hybrid leg (`_bm25_search` → TOKENS(@query, ...))
        # must NOT receive the prefix — its English analyzer would tokenize
        # the prefix tokens and dilute the real query terms. Stash the
        # original query in a side-channel so align_outputs(EMBEDDING) can
        # echo the RAW text to the retriever.
        # Issue #1035 (generalized): contrastive / instruction-tuned embedding
        # models require a query-side prefix at inference (per their model
        # card) to preserve the query/passage asymmetry. Apply only to queries
        # (and history strings, which act as queries for blending); passages
        # are encoded without the prefix by dataprep ingestion via the same
        # shared TEI service.
        #
        # The prefix decision is gated on `TEI_EMBED_MODEL` because chatqna
        # always encodes via the embedding microservice (TEI in the default
        # OPEA service graph) — the OpenAI branch in the retriever only kicks
        # in when the retriever itself encodes (the `embedding is None`
        # fallback). Even with OpenAI embeddings enabled deployer-side, the
        # chatqna → TEI path is unaffected unless the deployer rewires the
        # service graph away from the OPEA TEI wrapper.
        #
        # The retriever's BM25/hybrid leg (`_bm25_search` → TOKENS(@query, ...))
        # must NOT receive the prefix — its English analyzer would tokenize
        # the prefix tokens and dilute the real query terms. Stash the
        # original query in a side-channel so align_outputs(EMBEDDING) can
        # echo the RAW text to the retriever.
        _query_instruction = get_query_instruction(TEI_EMBED_MODEL)
        _original_query = inputs["text"]
        inputs["_original_query"] = _original_query
        if _blend_history_text:
            _texts = [_original_query, _blend_history_text]
            if _query_instruction:
                _texts = [_query_instruction + t for t in _texts]
            inputs["input"] = _texts
            # Stash alpha for align_outputs to use when blending the batch
            # response. `_blend_alpha` does leak into the embedding service HTTP
            # body (harmless — TEI ignores unknown JSON keys) but never reaches
            # the retriever: align_outputs(EMBEDDING) builds a fresh next_data
            # containing only {"text", "embedding"}, so the key is dropped at
            # that boundary, not by any underscore-prefix convention.
            inputs["_blend_alpha"] = _blend_alpha
        else:
            inputs["input"] = _query_instruction + _original_query if _query_instruction else _original_query
        del inputs["text"]

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        retriever_parameters = _gp(kwargs, "retriever_parameters")
        if retriever_parameters:
            # inputs.update(retriever_parameters.model_dump())
            safe_params = retriever_parameters.model_dump(exclude_unset=True, exclude_none=True)
            inputs.update(safe_params)

        # DATA CONTRACT: encode filter labels AND the authorized graph set
        # into search_start.
        #
        # The OPEA MicroService framework creates a dynamic __main__ input type
        # from the HTTP body when parsing requests at the retriever endpoint.
        # This dynamic type ONLY preserves standard EmbedDoc fields (text,
        # embedding, search_type, k, search_start, traversal_*, etc.). Custom
        # fields like "context" are silently dropped — verified via probes
        # (POST body has context, retriever's parsed input does not).
        #
        # To pass filter labels + the authorized graph set through this
        # contract boundary, encode them in search_start (a standard EmbedDoc
        # string field that survives parsing).
        # Format: "{base_mode}::labels:{l1},...::graphs:{g1},...::no_legacy:{true|false}"
        # The retriever parses this to build labels_to_filter for its DB-level
        # label filter (BM25 aql_filter_clause + dense post-filter) AND to
        # build the authorized graph set for the Epic-1 fan-out
        # (Story 1.0b/1.1/1.2; default [] = single-graph legacy).
        retrieval_context = _gp(kwargs, "retrieval_context", {})
        # Build filter labels (category singular/plural + service). The rule
        # lives in core.label_contract, shared with the retriever — the
        # SERVICE-PRECEDENCE generation: when service labels exist they ARE
        # the filter (a sibling service's chunks carry the category label, so
        # OR-filtering category+service would leak the service scope into the
        # whole category); the category filters on its own otherwise.
        _filter_labels = build_filter_labels(retrieval_context)
        # Authorized graph set (Story 1.0b/1.2) + the okf_only signal (Story
        # 1.1). The BFF carries both inside `context` — the only wire that
        # reaches genie_params (RequestContext → model_dump → retrieval_context)
        # — so read them from retrieval_context first; the flat kwargs paths
        # stay for the mocked test surface (genie_params={"authorized_graph_
        # names": [...]}) and any future direct forwarder. Empty list / False =
        # the legacy single-graph path runs unchanged.
        _ctx = retrieval_context if isinstance(retrieval_context, dict) else {}
        _graph_names = (_ctx.get("authorized_graph_names") or []) or (_gp(kwargs, "authorized_graph_names", []) or [])
        _exclude_legacy = bool(_ctx.get("exclude_legacy")) or bool(_gp(kwargs, "exclude_legacy", False))
        # Story 1.3 — conversation-continuity set (sticky routing). Read from the
        # same wire as authorized_graph_names (the `context` object). Empty =
        # first query of a conversation / feature absent → segment omitted and
        # the mocked pre-1.3 encode never sees the kwarg.
        _sticky_graph_names = (_ctx.get("sticky_graph_names") or []) or (_gp(kwargs, "sticky_graph_names", []) or [])
        if _exclude_legacy:
            logger.info("Carrier carries the okf_only signal (::no_legacy:) — the legacy free-form corpus is excluded")
        if _sticky_graph_names:
            logger.info(f"Carrier carries the sticky continuity set (::sticky:) — {len(_sticky_graph_names)} graph(s)")
        if _filter_labels and not _graph_names and not _exclude_legacy:
            # LEGACY CALL SURFACE: the labels-only path encodes through the
            # module-level encode_filter_labels binding (the labels-only
            # contract predates the multi-segment carrier; tests patch the
            # module name).

            _base_mode = inputs.get("search_start", "chunk")
            inputs["search_start"] = encode_filter_labels(_base_mode, _filter_labels)
        # DW-430 (review 2026-10-29 round 3): a sticky-only carrier (sticky
        # set, labels/graphs/no_legacy all falsy) must still encode — the
        # sticky⊆authorized invariant alone does not put the set on the wire.
        elif _filter_labels or _graph_names or _exclude_legacy or _sticky_graph_names:
            from core.label_contract import encode

            _base_mode = inputs.get("search_start", "chunk")
            if _exclude_legacy:
                # no_legacy/sticky are passed ONLY when set — the mocked encode in the
                # existing test suite has the pre-1.1 signature and must never
                # receive the kwargs on the default path.
                if _sticky_graph_names:
                    inputs["search_start"] = encode(
                        _base_mode,
                        labels=_filter_labels,
                        graphs=_graph_names,
                        no_legacy=True,
                        sticky=_sticky_graph_names,
                    )
                else:
                    inputs["search_start"] = encode(
                        _base_mode, labels=_filter_labels, graphs=_graph_names, no_legacy=True
                    )
            elif _sticky_graph_names:
                inputs["search_start"] = encode(
                    _base_mode, labels=_filter_labels, graphs=_graph_names, sticky=_sticky_graph_names
                )
            else:
                inputs["search_start"] = encode(_base_mode, labels=_filter_labels, graphs=_graph_names)

    elif self.services[cur_node].service_type == ServiceType.RERANK:
        reranker_parameters = _gp(kwargs, "reranker_parameters")
        if reranker_parameters:
            inputs.update(reranker_parameters.model_dump())
        if logflag:
            logger.debug(f"Aligned input of the reranker: {inputs}")

    elif self.services[cur_node].service_type == ServiceType.LLM:
        # convert TGI/vLLM to unified OpenAI /v1/chat/completions format
        next_inputs = {}
        next_inputs["model"] = _get_llm_model()

        rag_augmented_prompt = inputs["inputs"]
        # Get the full translated history *string* from kwargs
        translated_history_string = _gp(kwargs, "full_chat_history_string", "")

        user_details = _gp(kwargs, "user_details", {})

        user_context_string = ""

        if user_details:
            builder = UserContextBuilder()
            user_context_string = builder.build_user_context_string(user_details)
            logger.info(f"\n[ DEBUG ] user_context_string compiled {user_context_string}\n")

        ##################################
        ###### Token limit handling ######
        ##################################
        system_instructions = CHATQNA_SYSTEM_PROMPT

        # CRITICAL: Inject explicit English language instructions when language is EN
        # This overrides model bias toward Spanish responses
        original_language = _gp(kwargs, "original_language")
        if original_language and original_language.strip() == "EN":
            system_instructions = (
                "\n\nMANDATORY: You MUST respond ONLY in English. "
                "Do NOT respond in Spanish or any other language. "
                "All responses must be in English regardless of the "
                "content language.\n\n" + system_instructions
            )
            if logflag:
                logger.info(
                    f"[LANGUAGE DEBUG] Injected ENGLISH instruction into "
                    f"system prompt (original_language={original_language})"
                )

        # DEBUG: Log the system prompt to verify it's loaded correctly
        if logflag:
            logger.info(
                f"\n[SYSTEM PROMPT DEBUG] CHATQNA_SYSTEM_PROMPT loaded: {'YES' if system_instructions else 'NO'}"
            )
            if system_instructions:
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt length: {len(system_instructions)} chars")
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt preview: {system_instructions[:500]}...")
            else:
                logger.error("[SYSTEM PROMPT DEBUG] CHATQNA_SYSTEM_PROMPT IS NONE OR EMPTY!")

        # FIX: Separate system and user content for proper chat template handling
        user_content = _build_user_content(user_context_string, translated_history_string, rag_augmented_prompt)

        max_model_tokens = _get_max_model_len()
        max_answer_tokens = _resolve_answer_budget_tokens(llm_parameters_dict.get("max_tokens"))
        # Count tokens part by part: the pieces feed the history budget below,
        # so counting them separately costs nothing extra on overflow requests.
        # The 200-token buffer absorbs the ±1 boundary tokens a combined count
        # would merge.
        system_tokens = _count_static_tokens(system_instructions)
        user_content_tokens = _count_tokens(user_content)
        full_prompt_tokens = system_tokens + user_content_tokens
        _active_span = otel_trace.get_current_span()
        _set_attributes(
            _active_span,
            _prompt_budget_attributes(
                window_tokens=max_model_tokens,
                answer_budget_tokens=max_answer_tokens,
                estimate=full_prompt_tokens,
            ),
        )
        # Check if the total token count exceeds the model's limit
        if full_prompt_tokens + max_answer_tokens > max_model_tokens - 200:  # Leave buffer
            # Budget for the history: the window minus what is already known to
            # be there — the system prompt, the non-history part of the user
            # content, the answer reserve, and a safety buffer. The skeleton is
            # measured on the rebuilt (truncated) prompt template so it matches
            # what is finally sent. Segment separators (" |<-MSG->| ") are not
            # counted individually (~1-2 tokens per segment, absorbed by the
            # buffer).
            skeleton_tokens = _count_tokens(_build_user_content(user_context_string, "", rag_augmented_prompt))

            max_history_tokens = max_model_tokens - system_tokens - max_answer_tokens - skeleton_tokens - 200
            # Split the history into segments (empty history = nothing to drop)
            history_segments = translated_history_string.split(" |<-MSG->| ") if translated_history_string else []
            truncated_history = []
            current_tokens = 0
            # Start from most recent messages
            for segment in reversed(history_segments):
                segment_tokens = _count_tokens(segment)
                if current_tokens + segment_tokens > max_history_tokens:
                    break
                truncated_history.insert(0, segment)  # Maintain order
                current_tokens += segment_tokens
            dropped_segments = len(history_segments) - len(truncated_history)
            # Both counts are written here, inside the branch, so that
            # ABSENCE means "the guard did not run" rather than "0 segments".
            # segments_sent is the TRUNCATED length: recording the incoming
            # count for both would make a truncated turn look untouched.
            _set_attributes(
                _active_span,
                {
                    ATTRIBUTE_NAMES["rag_history_segments_in"]: len(history_segments),
                    ATTRIBUTE_NAMES["rag_history_segments_sent"]: len(truncated_history),
                },
            )
            _emit_budget_truncation_event(
                current_span=_active_span,
                dropped_segments=dropped_segments,
                window_tokens=max_model_tokens,
                answer_budget_tokens=max_answer_tokens,
                max_history_tokens=max_history_tokens,
            )
            if dropped_segments:
                # kept/dropped counts live in the warning log — metric attributes
                # stay low-cardinality (one series per path).
                history_truncation_total.add(1, {"path": "generation"})
                logger.warning(
                    "Chat history truncated to fit the LLM context window: "
                    "window_tokens=%s prompt_tokens=%s answer_budget_tokens=%s "
                    "kept_segments=%s dropped_segments=%s",
                    max_model_tokens,
                    full_prompt_tokens,
                    max_answer_tokens,
                    len(truncated_history),
                    dropped_segments,
                )
            # Rebuild truncated history
            translated_history_string = " |<-MSG->| ".join(truncated_history)
            # Reconstruct user content (system instructions stay the same) — the
            # same single template, so the model sees one consistent prompt
            # shape whether or not truncation ran.
            user_content = _build_user_content(user_context_string, translated_history_string, rag_augmented_prompt)

        # FIX: Send system and user as separate messages for proper chat template handling
        next_inputs["messages"] = [
            {"role": "system", "content": system_instructions},
            {"role": "user", "content": user_content},
        ]
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["top_p"] = llm_parameters_dict["top_p"]
        next_inputs["stream"] = inputs["stream"]
        if llm_parameters_dict.get("stream"):
            # vLLM returns `usage` on a streamed response only when the request
            # opts in. Without this the llm.invoke span reports tokens for the
            # sync path and nothing for the streaming path.
            #
            # DEPENDENCY (unverifiable from this tree): chatqna -> textgen -> vLLM
            # must forward `stream_options`. Whether the vendored textgen wrapper
            # does is only observable against a running deployment; if it is
            # dropped, streaming usage is unavailable at this layer and the
            # llm.invoke span omits the token attributes rather than reporting
            # wrong ones.
            next_inputs["stream_options"] = {"include_usage": True}
        next_inputs["frequency_penalty"] = inputs["frequency_penalty"]
        next_inputs["temperature"] = inputs["temperature"]
        # Stamp from next_inputs — the body actually sent — not from
        # llm_parameters_dict. max_tokens/top_p do come from that dict, but
        # temperature and frequency_penalty come from `inputs`, so a span
        # reading llm_parameters_dict would report values the wire never
        # carries: the exact blind spot this span exists to close. Reading the
        # body also collapses the divergence between next_inputs["stream"]
        # (from `inputs`) and the stream_options gate (from
        # llm_parameters_dict) onto one recorded truth.
        _stamp_llm_request_params_on_current_span(next_inputs)
        inputs = next_inputs
        if logflag:
            logger.debug(f"Raw input of the llm\n {inputs}\n")
            # DEBUG: Log the messages array being sent to LLM
            logger.info("\n[LLM DEBUG] Messages being sent to LLM:")
            for i, msg in enumerate(inputs["messages"]):
                logger.info(f"  Message {i}: role={msg['role']}, content_length={len(msg['content'])} chars")
                logger.info(f"  Message {i} content preview: {msg['content'][:200]}...")
            logger.info(f"\n[LLM DEBUG] Full messages array: {inputs['messages']}\n")

    return inputs


def align_outputs(self, data, cur_node, inputs, runtime_graph, llm_parameters_dict, **kwargs):
    next_data = {}

    if self.services[cur_node].service_type == ServiceType.EMBEDDING:
        if logflag:
            logger.debug(
                f"Raw output of the embedding: {type(data).__name__}, "
                f"keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}"
            )
        # OPEA embedding microservice returns {"data": [{"index": 0, "embedding": [...]}]}
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        if not isinstance(data, list):
            raise ValueError(f"Embedding service returned unexpected type: {type(data).__name__}, expected list")
        # Multi-turn vector-space blending (issue #833, E2 design): when the
        # embedding node was called with a batch [query, history] (see
        # align_inputs EMBEDDING), `data` holds 2 vectors. Blend them via
        # V = α·EQ + (1-α)·EH so the retriever's dense leg sees conversational
        # context. Single-input path (no history) = unchanged baseline.
        query_embedding = data[0]["embedding"]
        if len(data) > 1 and "_blend_alpha" in inputs:
            history_embedding = data[1]["embedding"]
            alpha = float(inputs.get("_blend_alpha", MULTI_TURN_BLEND_ALPHA))
            blended = _blend_embeddings(query_embedding, history_embedding, alpha)
            if logflag:
                logger.debug(f"Multi-turn blend applied at embedding: alpha={alpha}")
            # Batch path: inputs["input"] is [query, history]. The retriever's
            # BM25/hybrid leg needs the isolated QUERY string (it cannot use a
            # list — would 422 on pydantic text:str or feed garbage to BM25).
            # Only the dense leg consumes the blended embedding above.
            #
            # Issue #1035: align_inputs may have prepended the query
            # instruction to the first element. The retriever's BM25 path
            # tokenizes the raw query (TOKENS(@query, ...)) and the prefix
            # would dilute TF/IDF — so use the stashed raw text instead.
            # Raise if the stash is missing (no fallback to the prefixed
            # text — that would silently re-introduce the BM25 leak).
            # Pop after use so the side-channel does not leak into the
            # downstream service-graph dict (TEI / retriever / reranker
            # all parse `inputs` and may reject unknown keys).
            if "_original_query" not in inputs:
                raise ValueError(
                    "align_outputs(EMBEDDING) requires _original_query in inputs; "
                    "align_inputs(EMBEDDING) must run first to stash the raw text."
                )
            query_text = inputs.pop("_original_query")
            next_data = {"text": query_text, "embedding": blended}
        else:
            # Single-query path: align_inputs may have prepended the model
            # query instruction to inputs["input"]. Echo the raw text
            # (stashed by align_inputs as `_original_query`) so the
            # retriever's BM25 leg tokenizes the user's actual query
            # instead of the prefix. Raise if the stash is missing — no
            # fallback to the prefixed text (silent BM25-leak regression).
            # Pop after use so the side-channel does not leak downstream
            # (see batch path comment).
            if "_original_query" not in inputs:
                raise ValueError(
                    "align_outputs(EMBEDDING) requires _original_query in inputs; "
                    "align_inputs(EMBEDDING) must run first to stash the raw text."
                )
            next_data = {"text": inputs.pop("_original_query"), "embedding": query_embedding}

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        if logflag:
            logger.debug(
                f"Raw output of the retriever: {type(data).__name__}, "
                f"keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}"
            )
        retrieved_docs = data.get("retrieved_docs", [])

        # file_id pairs with retrieved doc id (generated by orchestrator)
        file_id_pairs = {}
        # Get the file ids (all ids in the metadata)
        file_id_list = []

        for item in data.get("metadata", []):
            if "file_ids" in item:
                file_id_list.extend(item["file_ids"])

        # Check if metadata is not None before checking length
        metadata = data.get("metadata")
        if metadata and len(metadata) > 0:
            if RETRIEVER_SEARCH_START == "node" or RETRIEVER_SEARCH_START == "edge":
                related_info_count = sum(
                    1 for doc in retrieved_docs if "\n------\nRELATED INFORMATION:\n------\n" in doc["text"]
                )
                if len(file_id_list) != related_info_count:
                    raise ValueError(
                        f"Length of file_id_list {len(file_id_list)} is not equal "
                        f"to related_info_count {related_info_count}"
                    )
                next_file_id = iter(file_id_list)
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    doc_text = retrieved_doc["text"]
                    if "\n------\nRELATED INFORMATION:\n------\n" in doc_text:
                        file_id_pairs[doc_id] = next(next_file_id)
                    else:
                        file_id_pairs[doc_id] = ""
            elif RETRIEVER_SEARCH_START == "chunk":
                if len(file_id_list) != len(retrieved_docs):
                    raise ValueError(
                        f"Length of file_id_list {len(file_id_list)} is not equal "
                        f"to length of retrieved_docs {len(retrieved_docs)}"
                    )
                next_file_id = iter(file_id_list)
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    file_id_pairs[doc_id] = next(next_file_id)
            else:
                logger.error(
                    f"RETRIEVER_SEARCH_START is not set correctly: "
                    f"{RETRIEVER_SEARCH_START}. It should be one of "
                    f"'node', 'edge', or 'chunk'."
                )

        if logflag:
            logger.debug(f"File ID Pairs: {file_id_pairs}")

        downstream_nodes = runtime_graph.downstream(cur_node)
        with_rerank = downstream_nodes and downstream_nodes[0].startswith("rerank")
        if with_rerank and retrieved_docs:
            # prepare inputs for rerank
            next_data["initial_query"] = data["initial_query"]
            next_data["retrieved_docs"] = retrieved_docs
            next_data["file_id_pairs"] = file_id_pairs
            # Forward the query embedding for adaptive reranking. Prefer the
            # request's embedding (inputs) — always present — then the retriever echo.
            query_embedding = inputs.get("embedding") if isinstance(inputs, dict) else None
            if not query_embedding:
                query_embedding = data.get("embedding")
            if query_embedding:
                next_data["embedding"] = query_embedding
            # Assemble chunk embeddings from the retriever's metadata list.
            # The retriever (EmbedDoc path) returns a SearchedMultimodalDoc where
            # metadata is a separate top-level list, not embedded in retrieved_docs
            # (TextDoc has no metadata field). The arangodb stashes each chunk's
            # embedding in this metadata list during the adaptive fetch.
            chunk_embeddings = []
            for md in data.get("metadata", []):
                ce = (md or {}).pop("chunk_embedding", None)
                chunk_embeddings.append(ce if isinstance(ce, list) and ce else [])
            if chunk_embeddings and all(ce for ce in chunk_embeddings):
                next_data["chunk_embeddings"] = chunk_embeddings

            # chunk_key recovery (parallel path — TextDoc has no metadata field,
            # so the retriever stashes per-chunk metadata in data["metadata"]).
            # Map text -> chunk_key here (retriever node, where metadata exists)
            # and carry it in next_data to the rerank node, where metadata is
            # stripped but selection happens. Consumed by _emit_reranker_selection_span.
            _ck_meta = data.get("metadata", [])
            _text_to_chunk_key = {
                retrieved_docs[i].get("text", ""): (_ck_meta[i] if i < len(_ck_meta) else {}).get("chunk_key", "N/A")
                for i in range(len(retrieved_docs))
            }
            if any(v != "N/A" for v in _text_to_chunk_key.values()):
                next_data["text_to_chunk_key"] = _text_to_chunk_key

            # Story 1.1 — per-hit provenance (graph_name/repo_id/concept_id)
            # rides the retriever's parallel metadata[] array (Story 1.0
            # fusion-time attribution). Preserve it keyed by doc id so the
            # source-assembly step can attribute OKF concept sources WITHOUT
            # calling okf-server (chatqna stays a service consumer — spec
            # Never rule; the BFF is the trusted side).
            _provenance_by_doc = {}
            for i in range(len(retrieved_docs)):
                md = _ck_meta[i] if i < len(_ck_meta) else {}
                prov = {k: md[k] for k in ("graph_name", "repo_id", "concept_id") if md.get(k) is not None}
                if prov:
                    _provenance_by_doc[retrieved_docs[i].get("id", "")] = prov
            if _provenance_by_doc:
                next_data["provenance_by_doc"] = _provenance_by_doc

            # Expected data format if using tei_reranker directly (bypassing reranker service):
            # next_data["query"] = data["initial_query"]
            # next_data["documents"] = retrieved_docs
            # next_data["texts"] = doc_texts
            # next_data["file_id_pairs"] = file_id_pairs

        else:
            if not retrieved_docs and with_rerank:
                # delete the rerank from retriever -> rerank -> llm
                for ds in reversed(runtime_graph.downstream(cur_node)):
                    for nds in runtime_graph.downstream(ds):
                        runtime_graph.add_edge(cur_node, nds)
                    runtime_graph.delete_node_if_exists(ds)

            # handle template
            received_prompt = data.get("initial_query", inputs.get("text", ""))
            # Condense mode (issue #1091): the RAG prompt question is the RAW
            # last user message; the rewritten standalone query is retrieval and
            # rerank input only — it must never enter the answer-LLM prompt.
            received_prompt = _condense_raw_or(kwargs, received_prompt)

            if _abstention_enforced():
                abstention_instructions = (
                    CHATQNA_ABSTENTION_INSTRUCTIONS
                    if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                    else _DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
                )
                received_prompt += abstention_instructions

            prompt = received_prompt

            # System instructions for integration of retrieved documents
            # are already included in the CHATQNA_SYSTEM_PROMPT
            # OPTIONAL:
            # Re-introduce the below code, to dynamically pass custom
            # instructions or to condition them based on retrieved documents
            # chat_template = llm_parameters_dict["chat_template"]
            # if chat_template:
            #     prompt_template = PromptTemplate.from_template(chat_template)
            #     input_variables = prompt_template.input_variables
            #     if sorted(input_variables) == ["context", "question"]:
            #         prompt = prompt_template.format(question=received_prompt, context="\n".join(doc_texts))
            #     elif input_variables == ["question"]:
            #         prompt = prompt_template.format(question=received_prompt)
            #     else:
            #         if logflag:
            #             logger.debug(
            #                 f"{prompt_template} not used, we only support "
            #                 "2 input variables ['question', 'context']"
            #             )
            #         prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)
            # else:
            #     prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)

            next_data["inputs"] = prompt

        next_data["retrieved_docs"] = retrieved_docs

    elif self.services[cur_node].service_type == ServiceType.RERANK:
        # OPEA v1.5's ServiceOrchestrator.execute() does not check HTTP status
        # (no raise_for_status), so the reranker's 422 body arrives here as the
        # node's "successful" output dict. Detect the typed error body and
        # re-raise as the local marker so handle_request dispatches the
        # reranker-input-too-long abstention instead of treating it as data.
        if (
            isinstance(data, dict)
            and isinstance(data.get("detail"), dict)
            and data["detail"].get("error_type") == _RERANKER_INPUT_TOO_LONG_TYPE
        ):
            raise _RerankerInputTooLongError(f"downstream service returned: {data['detail'].get('error', 'unknown')}")
        if logflag:
            logger.info(f"\n[ DEBUG ] MICROSERVICE RERANK OUTPUT: {data}")

        docs = []
        reranked_docs_with_scores = []

        # RECOVERY OF IDs: Create a mapping of text to original document ID
        original_retrieved_docs = inputs.get("retrieved_docs", [])
        text_to_id = {doc.get("text", ""): doc.get("id", "N/A") for doc in original_retrieved_docs}
        # chunk_key was carried here from the retriever node (where metadata
        # exists) via next_data["text_to_chunk_key"]. At this (rerank) node,
        # TextDoc has no metadata field, so data["metadata"] is empty — we MUST
        # use the carried map. Maps text -> ArangoDB _key.
        text_to_chunk_key = inputs.get("text_to_chunk_key", {}) or {}

        # 1. Handle output from custom Genie Python Wrapper
        if isinstance(data, dict):
            if "reranked_docs" in data:
                for doc in data["reranked_docs"]:
                    doc_text = doc.get("text", "")
                    docs.append(doc_text)

                    # Reconstruct the rich document object for the frontend
                    reranked_docs_with_scores.append(
                        {"id": text_to_id.get(doc_text, "N/A"), "text": doc_text, "score": doc.get("score", 0.0)}
                    )
            elif "documents" in data:
                for doc_text in data["documents"]:
                    docs.append(doc_text)
                    reranked_docs_with_scores.append(
                        {"id": text_to_id.get(doc_text, "N/A"), "text": doc_text, "score": 0.0}
                    )

        # 2. Fallback for raw TEI output
        elif isinstance(data, list):
            reranker_parameters = _gp(kwargs, "reranker_parameters")
            top_n = reranker_parameters.top_n if reranker_parameters else 1
            original_docs = inputs.get("documents", [])

            for best_response in data[:top_n]:
                doc_index = best_response.get("index")
                if doc_index is not None and doc_index < len(original_docs):
                    reranked_doc = original_docs[doc_index]
                    reranked_doc["score"] = best_response.get("score")
                    reranked_docs_with_scores.append(reranked_doc)
                    docs.append(reranked_doc.get("text", ""))

        # 3. Build the RAG prompt
        initial_query = inputs.get("initial_query", " ")
        # Condense mode (issue #1091): the RAG prompt question is the RAW
        # last user message; the rewritten standalone query is retrieval and
        # rerank input only — it must never enter the answer-LLM prompt.
        initial_query = _condense_raw_or(kwargs, initial_query)

        # System instructions for integration of retrieved documents are already included in the CHATQNA_SYSTEM_PROMPT
        # OPTIONAL:
        # Re-introduce the below code, to dynamically pass custom instructions
        # or to condition them based on retrieved documents
        # chat_template = llm_parameters_dict.get("chat_template") if llm_parameters_dict else None

        # if chat_template:
        #     prompt_template = PromptTemplate.from_template(chat_template)
        #     input_variables = prompt_template.input_variables
        #     if sorted(input_variables) == ["context", "question"]:
        #         prompt = prompt_template.format(question=initial_query, context="\n".join(docs))
        #     elif input_variables == ["question"]:
        #         prompt = prompt_template.format(question=initial_query)
        #     else:
        #         prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)
        # else:
        #     prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)

        if not docs and _abstention_enforced():
            abstention_instructions = (
                CHATQNA_ABSTENTION_INSTRUCTIONS
                if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                else _DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS
            )
            next_data["inputs"] = initial_query + abstention_instructions
        else:
            next_data["inputs"] = initial_query + "".join(
                f"\n[Retrieved Document]: {doc}" for doc in docs
            )  # prompt <- change to 'prompt' if you re-introduce the code above

        next_data["retrieved_docs"] = reranked_docs_with_scores

        # Emit selection identity for retrieval-quality eval (recall/precision).
        # Recover chunk_key via text (mirrors text_to_id) from the parallel
        # data["metadata"] the retriever stashed.
        candidate_chunk_keys = [text_to_chunk_key.get(doc.get("text", ""), "N/A") for doc in original_retrieved_docs]
        selected_chunk_keys = [text_to_chunk_key.get(d.get("text", ""), "N/A") for d in reranked_docs_with_scores]
        selected_scores = [round(float(d.get("score", 0.0)), 6) for d in reranked_docs_with_scores]
        _emit_reranker_selection_span(candidate_chunk_keys, selected_chunk_keys, selected_scores)

        # 4. Preserve file mappings for citation:
        if "file_id_pairs" in inputs:
            next_data["file_id_pairs"] = inputs["file_id_pairs"]

    elif self.services[cur_node].service_type == ServiceType.LLM and not llm_parameters_dict["stream"]:
        _llm_span = _emit_llm_invoke_open(llm_parameters_dict)
        try:
            _emit_llm_invoke_record(_llm_span, data)
            _service_path = urlparse(self.services[cur_node].endpoint).path
            if _service_path:
                _llm_span.set_attribute(ATTRIBUTE_NAMES["llm_service_path"], _service_path)
            if "faqgen" in self.services[cur_node].endpoint:
                next_data = data
            else:
                if logflag:
                    logger.debug(f"\nRaw output of the llm\n {data}\n")
                next_data["text"] = data["choices"][0]["message"]["content"]
        finally:
            _emit_llm_invoke_close(_llm_span)
        if logflag:
            logger.debug(f"\nAligned output of the llm\n {next_data}\n")
    else:
        next_data = data

    if logflag:
        logger.debug(
            f"FINAL ALIGNED DATA keys: {list(next_data.keys())}, text length: {len(next_data.get('text', ''))}"
        )

    return next_data


def align_generator(self, gen, *, parent_context=None, **kwargs):
    """Wrap the LLM byte stream, recording it on an ``llm.invoke`` span.

    A NON-generator on purpose, delegating the body to ``_align_generator_body``.
    As a generator function its body would not run until something iterated it,
    so every read of the active context inside the body would happen at first
    iteration rather than at call time. If the framework hands out the lazy
    chain from ``schedule()``, first iteration can land after the
    ``chatqna.orchestrate`` ``with`` block has closed -- the active context then
    belongs to the request task, and an ``llm.invoke`` span opened there starts a
    NEW trace and never appears beside the retrieval and reranking spans it
    belongs with. Capturing the context here, before the body is handed on, is
    strictly earlier than first iteration and strictly no worse.

    Whether comps calls the align function inside the orchestrate block cannot be
    verified from this source tree: ``comps`` is vendored at build time and is
    not installed in the test venv. So this removes one failure mode without
    proving the span always joins the RAG trace -- ``parent_context`` lets a
    caller that knows better state the parent explicitly.

    The signature is comps': ``align_generator(self, gen, **kwargs)``. Nothing
    new is required of the caller.

    UNVERIFIED, and recorded rather than assumed: the hook is registered as
    ``ServiceOrchestrator.align_generator``, and whether comps branches on
    ``inspect.isgeneratorfunction(...)`` before invoking it cannot be checked
    from this source tree. The normal shape — call the hook, iterate what it
    returns — is unaffected by the wrapper. If comps did require a generator
    function by type, the consequence would be a total streaming outage rather
    than a missing attribute, so it is worth a check against a running
    deployment before this reaches production.
    """
    return _align_generator_body(
        gen,
        kwargs.get("llm_parameters_dict") or {},
        # Resolved HERE, not inside the body: a fallback evaluated at first
        # iteration is exactly the late read this split exists to prevent.
        parent_context=otel_context.get_current() if parent_context is None else parent_context,
    )


def _align_generator_body(gen, llm_parameters_dict, parent_context):
    # OpenAI response format
    # data:{"id":"","object":"text_completion","created":1725530204,
    # "model":"meta-llama/Meta-Llama-3-8B-Instruct","system_fingerprint":"2.0.1-native",
    # "choices":[{"index":0,"delta":{"role":"assistant","content":"?"},"logprobs":null,
    # "finish_reason":null}]}\n\n'
    _llm_span = _emit_llm_invoke_open(
        llm_parameters_dict,
        stream_known=True,
        parent_context=parent_context,
    )
    try:
        for line in gen:
            # errors="replace" matches the encode-side policy: one undecodable
            # byte costs one replacement character (U+FFFD on decode, '?' on
            # encode), never a torn-down stream.
            line = line.decode("utf-8", errors="replace")
            chunks = [chunk.strip() for chunk in line.split("\n\n") if chunk.strip()]
            for line in chunks:
                start = line.find("{")
                end = line.rfind("}") + 1
                json_str = line[start:end]
                try:
                    json_data = json.loads(json_str)
                except Exception:
                    # Unparseable line ("sometimes yield empty chunk"): forward
                    # it verbatim — this fallback is for framing the
                    # orchestrator cannot read as JSON at all, never for parsed
                    # frames (those are handled below without re-emission).
                    yield f"data: {repr(json_str.encode('utf-8'))}\n\n"
                    continue
                # From here the frame PARSED: it is structured data, not answer
                # text gone missing — nothing below may re-emit its raw JSON.
                # The recorder is defensive by contract (never raises on any
                # JSON-decoded frame; pinned by tests) — it stays outside the
                # skip guard so a recorder bug surfaces instead of being
                # swallowed.
                _emit_llm_invoke_record(_llm_span, json_data)
                _unroutable = False
                try:
                    answer_text = _stream_answer_text(json_data)
                except Exception as _e:
                    _unroutable = True
                    _skip_reason = f"exception={type(_e).__name__}"
                else:
                    _skip_reason = None if answer_text is not None else "no forwardable content"
                if _skip_reason is not None:
                    # A parsed frame with no forwardable content is transport
                    # metadata — the terminal usage-only frame the
                    # include_usage opt-in adds, the guaranteed finish_reason
                    # chunk (empty delta), a keepalive, a tool-call delta, an
                    # upstream error object. It was already recorded on the
                    # span above and is skipped here rather than leaked as raw
                    # JSON or allowed to tear down a live stream. The span
                    # event + log keep the skip diagnosable: contentless
                    # metadata is EXPECTED on every streamed turn and logs at
                    # debug (a per-turn warning would flatten the warn-rate
                    # baseline); an upstream error and a frame the extractor
                    # cannot route at all are worth a warning.
                    _llm_span.add_event("chatqna.stream.frame_skipped", {"reason": _skip_reason})
                    if isinstance(json_data, dict) and "error" in json_data:
                        logger.warning(f"LLM stream frame carried an upstream error (frame keys={sorted(json_data)})")
                    elif _unroutable:
                        logger.warning(f"Skipped an LLM stream frame that could not be routed ({_skip_reason})")
                    else:
                        logger.debug(f"Skipped a contentless LLM stream frame ({_skip_reason})")
                else:
                    # errors="replace": one unencodable codepoint must not
                    # discard the whole chunk's answer text.
                    yield f"data: {repr(answer_text.encode('utf-8', errors='replace'))}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        # Closes even if the upstream generator raises or the consumer abandons
        # the stream mid-iteration.
        _emit_llm_invoke_close(_llm_span)


class ChatQnAService:
    def __init__(self, host="0.0.0.0", port=8888):
        self.host = host
        self.port = port
        ServiceOrchestrator.align_inputs = align_inputs
        ServiceOrchestrator.align_outputs = align_outputs
        ServiceOrchestrator.align_generator = align_generator
        self.megaservice = ServiceOrchestrator()
        self.endpoint = str(MegaServiceEndpoint.CHAT_QNA)
        self.user_profile_client = GenieUserProfileClient()

    def _find_node_key(self, service_name: str, result_dict: dict) -> str | None:
        """Helper to find the full key for a service in the result_dict."""
        return _find_node_key(result_dict, service_name)

    async def fetch_file_metadata(self, file_id: str, token: str) -> dict:
        """
        Fetch metadata for a file by calling the relevant API.

        Args:
            file_id (str): The ID of the file to fetch metadata for.
            token (str): Bearer token forwarded on the outbound call to document-repository.

        Returns:
            dict: A dictionary containing metadata, including labels. None if no token
            or the call fails.
        """
        if not file_id:
            return {"categoryLabels": None, "serviceLabels": []}

        if not token:
            logger.error("fetch_file_metadata called without token — caller must pass the validated Bearer token.")
            return None

        file_get_metadata_url = f"{DOC_REPO_URL}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {token}"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            async with (
                aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(
                        total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
                    )
                ) as session,
                session.get(file_get_metadata_url, headers=headers) as response,
            ):
                if response.status == 200:
                    file_metadata = await response.json()
                    if logflag:
                        logger.debug(f"Fetched metadata for file ID {file_id}: {file_metadata}")
                    if file_metadata["success"]:
                        return file_metadata["data"]
                    else:
                        logger.error(f"Failed to fetch metadata for file ID {file_id}. Response indicates failure.")
                else:
                    logger.error(f"Failed to fetch metadata for file ID {file_id}. HTTP Status: {response.status}")
        except Exception as e:
            logger.error(f"An error occurred while fetching metadata for file ID {file_id}: {e}")

        return None
        # return []

    async def _finalize_llm_response(
        self, llm_response: str, original_language: str | None
    ) -> tuple[str, float | None, str | None]:
        """Strip leaked conversation markers + the self-grade sentinel, then translate.

        Extracted from handle_request so the strip-before-translate ordering (the #1
        sentinel/translation collision risk) is unit-testable: the sentinel is removed
        from ``llm_response`` BEFORE it is handed to the translation pipeline. Returns
        ``(final_text_response, self_confidence_or_None, translation_status_or_None)``.

        The translation status says what happened to the text the caller reads:
        ``"ok"`` when it was translated, ``"refused"`` when the requested
        language was refused and the English answer was kept, ``"failed"``
        when the translation broke and the English answer was kept, and
        ``None`` when no translation was asked for. A caller that shows an
        answer the user asked to be translated has to be able to tell an
        English answer it did not translate from a translated one.
        """
        # Strip leaked conversation markers from the LLM response. The LLM sometimes
        # echoes back the |<-MSG->| delimiters and USER:/ASSISTANT: role markers used
        # internally to format chat history in the prompt. Same shared patterns as the
        # streaming path (_stream_with_metadata) — see _CONV_SEP_RE / _CONV_ROLE_RE.
        llm_response = _CONV_SEP_RE.sub("\n", llm_response)
        llm_response = _CONV_ROLE_RE.sub("", llm_response)
        # vLLM's terminal usage-only frame can also be embedded in the
        # assembled non-streaming text (the orchestrator concatenates the
        # same chunk stream) — strip it so the non-streaming path matches the
        # streaming one (live 2026-10-23 system-leak fix).
        if _is_usage_only_frame(llm_response):
            llm_response = ""
        llm_response = _EXCESS_BLANK_RE.sub("\n\n", llm_response)

        # Strip the self-grade sentinel before translation so it never reaches the
        # user or the translation pipeline; capture its value for metadata.
        self_confidence = None
        if LLM_SELF_CONFIDENCE_ENABLED:
            llm_response, self_confidence = _extract_self_confidence(llm_response)

        # None until a translation is actually asked for: the status describes
        # what happened to the text the caller reads.
        translation_status = None

        if original_language and original_language.strip() != "EN":
            if logflag:
                logger.info(f"Translation requested - original_language: '{_language_display(original_language)}'")

            # Load Language Codes
            language_codes = language_codes_map()

            if logflag:
                keys_preview = list(language_codes.keys())[:10]
                logger.info(f"Language codes loaded - keys: {keys_preview}... (total: {len(language_codes)})")

            # The target language is taken from the map, never from the
            # request: an unknown code is refused and the English answer is
            # returned as-is, instead of the raw string steering the model.
            resolved_language = _resolve_language_code(original_language, language_codes)

            if resolved_language is None:
                if language_codes:
                    logger.warning(
                        f"Language '{_language_display(original_language)}' is not a known language code — "
                        "refusing to translate and returning the English answer."
                    )
                else:
                    logger.error(
                        "Language map is empty or unreadable — every language is unknown, "
                        "so translation is refused and the answer is returned in English. "
                        "Check that the language registry is readable at the configured path."
                    )
                final_text_response = llm_response
                translation_status = "refused"
            else:
                target_lang_name = language_codes[resolved_language.lower()]

                if logflag:
                    logger.info(f"Found language code mapping: '{resolved_language.lower()}' -> '{target_lang_name}'")
                    logger.debug(f"LLM response to be translated into: {target_lang_name}")

                try:
                    final_text_response = await self._translate_with_chunking(llm_response, resolved_language)
                    translation_status = "ok"
                    if logflag:
                        logger.info("Translation completed successfully")
                except TranslationInputTooLongError:
                    # Fail-loud: translation overflow is a permanent contract issue
                    # (chunk too long for the configured model window). Fall-through
                    # to returning the original English text would mask the failure
                    # from the route layer, breaking issue #829's multilingual UX.
                    # Re-raise so the route handler can map it to HTTP 422 / 500.
                    raise
                except Exception as e:
                    logger.error(f"Translation failed: {e}, returning original response")
                    final_text_response = llm_response
                    translation_status = "failed"
        else:
            final_text_response = llm_response

        if logflag:
            logger.debug(f"\nFinal Text Response: {final_text_response}")

        return final_text_response, self_confidence, translation_status

    async def _assemble_source_documents(
        self, result_dict: dict, token: str, include_contexts: bool = False
    ) -> tuple[list, float, bool]:
        """Build the source-document list, confidence, and grounding flag from the graph output.

        Source documents reflect the **reranker's verdict**, not the retriever's raw cosine
        hits (which are always moderate-high for same-domain text and would surface
        irrelevant references with a misleading confidence whenever the reranker found
        nothing relevant).

        Grounding (``is_grounded``):
          - With a reranker in the pipeline: True iff at least one doc passed the relevance
            threshold (i.e. the LLM had document backing for its answer).
          - Without a reranker: True iff the retriever returned at least one doc.
        When not grounded, no source documents are returned and confidence is 0.0; the
        frontend flags the response as AI-generated rather than showing a score.

        Args:
            result_dict: The megaservice orchestrator output keyed by node name.
            include_contexts: Benchmark opt-in — attach each doc's served chunk text to the
              source document, so an evaluator scores the contexts the model actually saw.
              Citizen payloads never set it; responses are otherwise byte-identical.

        Returns:
            (source_documents, retrieval_confidence_score, is_grounded)
        """
        rerank_key = self._find_node_key("rerank", result_dict)
        retriever_key = self._find_node_key("retriever", result_dict)

        retriever_node_output = result_dict.get(retriever_key, {})
        # Same tolerance as _node_docs: a non-dict node output is a malformed
        # result, not a crash — the grounding decision degrades instead.
        file_id_pairs = (
            retriever_node_output.get("file_id_pairs", {}) if isinstance(retriever_node_output, dict) else {}
        )
        # Story 1.1 — per-hit retrieval provenance carried from the retriever
        # node (graph_name/repo_id/concept_id, keyed by orchestrator doc id).
        # Same non-dict tolerance as file_id_pairs above.
        provenance_by_doc = (
            retriever_node_output.get("provenance_by_doc", {}) if isinstance(retriever_node_output, dict) else {}
        ) or {}
        # Retriever docs carry the orchestrator id + text + similarity score (metadata.score).
        # Same accessor as the abstention flag: one node, one meaning.
        retrieved_docs = _node_docs(result_dict, "retriever") or []

        # The reranker's verdict. NOTE: align_outputs (RERANK branch) stores the reranked
        # docs under the "retrieved_docs" key — with id + reranker score already
        # reconstructed — NOT under "reranked_docs" (that key is empty in the orchestrator
        # output). Each verdict doc is {id, text, score} where score is the reranker score.
        rerank_verdict = _node_docs(result_dict, "rerank") or []

        # Normalize the documents to display into (id, score) tuples.
        if rerank_key:
            display_docs = [{"id": doc.get("id", "N/A"), "score": doc.get("score", 0.0)} for doc in rerank_verdict]
        else:
            display_docs = [
                {
                    "id": doc.get("id", "N/A"),
                    "score": (doc.get("metadata") or {}).get("score", doc.get("score", 0.0)),
                }
                for doc in retrieved_docs
            ]
        is_grounded = bool(display_docs)
        logger.info(
            f"Grounding decision: is_grounded={is_grounded} "
            f"(reranker_present={bool(rerank_key)}, "
            f"rerank_verdict={len(rerank_verdict)}, retriever_docs={len(retrieved_docs)})"
        )

        # Benchmark opt-in: id -> served chunk text, from the reranker's verdict
        # (each verdict doc is {id, text, score}) with the retriever's raw docs as
        # fallback when no reranker node ran. Only consulted when the caller set
        # include_contexts — the citizen path never builds the map.
        text_by_doc = {}
        if include_contexts:
            for doc in rerank_verdict if rerank_key else retrieved_docs:
                doc_id = doc.get("id")
                doc_text = doc.get("text")
                if doc_id and doc_text:
                    text_by_doc[doc_id] = doc_text

        source_documents_formatted = []
        scores = []
        source_documents_file_ids = []

        if logflag:
            logger.debug(f"display docs count: {len(display_docs)}, scores: {[d.get('score') for d in display_docs]}")

        for item in display_docs:
            doc_id_by_orchestrator = item.get("id", "N/A")
            if doc_id_by_orchestrator not in file_id_pairs:
                logger.warning(f"Warning: Document ID {doc_id_by_orchestrator} not found in file_id_pairs mapping.")
                continue

            file_id = file_id_pairs[doc_id_by_orchestrator]
            if not file_id:
                logger.warning(f"Warning: No File ID mapped for Document ID {doc_id_by_orchestrator}.")
                continue
            if file_id in source_documents_file_ids:
                logger.info(f"Note: Duplicate File ID {file_id} found. Skipping duplicate.")
                scores.append(_calibrate_reranker_score(item.get("score", 0.0)))
                # Benchmark opt-in (include_contexts): the skipped chunk WAS
                # served to the model (the citizen payload is unchanged — no
                # text on it), but the evaluator must see every served
                # chunk's text, so append it to the surviving doc instead of
                # dropping it — otherwise a reference passage living in the
                # second chunk of a file scores context_recall 0 although it
                # was delivered.
                if include_contexts:
                    dup_text = text_by_doc.get(doc_id_by_orchestrator)
                    if dup_text:
                        for existing in source_documents_formatted:
                            if existing.get("document_id") == file_id:
                                # Merge into the surviving doc's context; when the
                                # surviving doc has no text yet (its own chunk
                                # carried none in the verdict), the duplicate's
                                # text must still land — not be dropped (review
                                # 2026-10-29 round 3).
                                existing["text"] = f"{existing['text']}\n{dup_text}" if "text" in existing else dup_text
                                break
                continue

            logger.info(f"Document ID {doc_id_by_orchestrator} mapped to File ID {file_id}.")

            score = _calibrate_reranker_score(item.get("score", 0.0))
            # Clients (web + mobile) build the view URL from their own public base + file_id.
            # Emitting the internal BACKEND_SERVICE_URL here would give the browser an
            # unreachable hostname (DNS_PROBE_FINISHED_NXDOMAIN), so leave it empty for
            # normal files. Crawled HTML pages carry a real external source_url (set below).
            file_read_url = ""

            labels = []
            file_name = ""
            if file_id:
                file_metadata = await self.fetch_file_metadata(file_id, token=token)
                if file_metadata and isinstance(file_metadata, dict):
                    labels = file_metadata["labels"]
                    file_name = file_metadata.get("file_name", "")
                    logger.info(f"Labels for file ID {file_id}: {labels}")
                    logger.info(f"File name for file ID {file_id}: {file_name}")
                    author = file_metadata.get("author", "")
                    if author == "crawler" and file_name.endswith(".html"):
                        # If the author is 'crawler' and the file is an HTML, we can assume it's a web page
                        file_read_url = file_metadata.get("source_url", file_read_url)
                        logger.info(f"Updated file read URL for crawled HTML: {file_read_url}")
                else:
                    # D1 fix: a failed metadata lookup must not surface a fake
                    # "error" source document, and must not inject a forced 0.0
                    # into the confidence aggregation. Previously this branch fell
                    # through to `scores.append(score)` with score=0, which tanked
                    # the confidence mean whenever the document-repository/backend
                    # metadata call failed intermittently — the prime cause of
                    # "anormally low" confidence reported in production.
                    #
                    # OKF concept chunks (Story 4.8-amend content-only chunking)
                    # carry file_id == concept_id — those resolve in okf-server,
                    # NOT doc-repository, so this fetch 404s BY DESIGN for every
                    # OKF-sourced hit. Skipping them (the old behavior) threw
                    # away all OKF ground truth and forced is_grounded=False on
                    # every OKF query (live-caught 2026-10-06: retriever
                    # legs=9/fused=20 with Alphabet concepts in hand, yet zero
                    # sources surfaced and the answer was flagged AI-generated).
                    # Surface the hit from its IN-PAYLOAD retrieval provenance
                    # instead — no okf-server call (chatqna stays a service
                    # consumer; the BFF is the trusted side). Doc-repo files
                    # keep the enriched path above verbatim.
                    #
                    # The fallback is gated on the hit actually being
                    # OKF-sourced (provenance graph_name carries the OKF_
                    # prefix — the legacy tail attaches the legacy graph name,
                    # and a failed doc-repo fetch on a LEGACY hit is a
                    # transient outage or a deleted file, exactly what the D1
                    # rule refuses to fabricate a source for). Without the
                    # gate, one doc-repo 500 on a pure-legacy path invented an
                    # "okf-concept" source from nothing (review 2026-10-29).
                    prov = provenance_by_doc.get(doc_id_by_orchestrator, {})
                    prov_graph = str(prov.get("graph_name") or "")
                    if not prov_graph.startswith("OKF_"):
                        logger.info(
                            f"doc-repo metadata absent for file ID {file_id} — provenance "
                            f"graph is not an OKF graph ({prov_graph or 'none'}); the D1 rule "
                            f"applies: no source surfaced, no confidence poison"
                        )
                        continue
                    logger.info(
                        f"doc-repo metadata absent for file ID {file_id} — surfacing "
                        f"as OKF concept source (graph_name={prov.get('graph_name', 'n/a')}, "
                        f"concept_id={file_id})"
                    )
                    source_documents_file_ids.append(file_id)
                    okf_source = {
                        "document_id": file_id,
                        "document_name": str(file_id).replace("_", " ").strip(),
                        "url": "",
                        "categoryLabels": [],
                        "serviceLabels": [],
                        "score": score,
                        "concept_id": file_id,
                        "source": "okf-concept",
                    }
                    if prov.get("graph_name"):
                        okf_source["graph_name"] = prov["graph_name"]
                    if prov.get("repo_id"):
                        okf_source["repo_id"] = prov["repo_id"]
                    if include_contexts and text_by_doc.get(doc_id_by_orchestrator):
                        okf_source["text"] = text_by_doc[doc_id_by_orchestrator]
                    source_documents_formatted.append(okf_source)
                    scores.append(score)
                    continue

            # Mark this file as surfaced only after a successful metadata resolution,
            # so a duplicate of a file whose metadata failed does not contribute its
            # score to the aggregate while the file remains invisible (M3).
            source_documents_file_ids.append(file_id)
            formatted_doc = {
                "document_id": file_id,
                "document_name": file_name,
                "url": file_read_url,
                "categoryLabels": labels if isinstance(labels, list) else [labels] if labels else [],
                "serviceLabels": [],
                "score": score,
            }
            if include_contexts and text_by_doc.get(doc_id_by_orchestrator):
                formatted_doc["text"] = text_by_doc[doc_id_by_orchestrator]
            source_documents_formatted.append(formatted_doc)
            scores.append(score)
            logger.debug(f"appending document conf score: {score} ")

        # Rank-weighted retrieval confidence; 0.0 when not grounded.
        #
        # The plain arithmetic mean is count-dependent and tail-sensitive: the
        # adaptive reranker strategy keeps low-scoring-but-novel chunks, each of
        # which dragged the mean down, so richer context was *punished*. Weighting
        # by rank (rank 0 = most relevant, since reranker verdicts are descending
        # and `scores` preserves that display order) lets the strongest match
        # dominate instead. See site/content/en/docs/architecture/architecture.md §9.4.
        retrieval_confidence_score = _rank_weighted_confidence(scores)
        logger.debug(f"document confidence scores: {scores}")

        if not source_documents_formatted and is_grounded:
            # Edge case (e.g. document-repository outage): the reranker found
            # documents (is_grounded=True) but none could be resolved into sources.
            # Force not-grounded so the UI does not claim backing that is absent.
            logger.warning("No source documents could be assembled; forcing is_grounded=False.")
            is_grounded = False

        return source_documents_formatted, retrieval_confidence_score, is_grounded

    async def _stream_with_metadata(
        self,
        body_iterator,
        result_dict,
        token: str,
        parent_context=None,
        filter_labels=None,
        abstained=False,
        abstention_reason=None,
        include_contexts: bool = False,
        query_translation_status: str | None = None,
    ):
        """Forward the LLM token stream, then append a `metadata` SSE event.

        ``query_translation_status`` carries what the history translator fed
        the embedder (``translated`` / ``passthrough_english`` /
        ``passthrough_unknown_language`` / ``fallback_timeout`` /
        ``fallback_error``): a streamed answer must be as observable as a
        JSON one about the language its retrieval query was really in. It is
        stamped on ``chatqna.orchestrate`` as well, so the trace and the
        payload cannot disagree.

        ``abstained`` / ``abstention_reason`` carry the outcome handle_request
        already derived for the request metric, so the counter and this
        metadata event cannot disagree about the same turn.

        The metadata event carries the reranker-grounded source documents, confidence,
        and ``is_grounded`` flag, emitted as plain JSON **before** the terminal ``[DONE]``
        so downstream consumers (backend → web/mobile) receive document backing for the
        streamed answer instead of re-running retrieval themselves.

        Token chunks are Python-repr-encoded by the orchestrator's ``align_generator``.
        Before forwarding, the same ``|<-MSG->|`` / ``USER:`` / ``ASSISTANT:`` stripping
        that the non-streaming path applies to the assembled response is applied here, so
        internal conversation markers the LLM echoes back never leak to the frontend. A
        marker may be split across token chunks, so content is buffered: only the settled
        head is re-emitted and a tail that could be the start of a marker is held back.

        The terminal ``[DONE]`` is suppressed and re-emitted after the metadata. Metadata
        is computed **after** the token stream so it never delays Time-To-First-Token.

        ``parent_context`` is the chatqna.orchestrate context captured by handle_request.
        It parents the answer-level outcome span emitted once the metadata is known.
        """
        buffer = ""
        self_confidence = None  # LLM self-grade value, captured from the sentinel
        async for chunk in body_iterator:
            text = chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else str(chunk)
            if text.strip() == "data: [DONE]":
                # Suppress the terminal [DONE]; re-emit it after the metadata event.
                continue
            content = self._extract_sse_content(text)
            if content is None:
                # Unparseable chunk (not data: b'...'): forward verbatim so an
                # unexpected orchestrator format never breaks the stream.
                yield text
                continue
            if _is_usage_only_frame(content):
                # vLLM's terminal usage-only chunk: transport metadata, not
                # answer content — never forward it to the user.
                continue
            buffer += content
            buffer = _CONV_SEP_RE.sub("\n", buffer)
            buffer = _CONV_ROLE_RE.sub("", buffer)
            # Collapse runs of 3+ newlines down to a single paragraph break.
            # Granit's chat style over-separates sections in its markdown output;
            # without this the user sees extra visual blank lines between blocks
            # (header→list, list→next header). Collapsing here keeps the held-back
            # marker tail consistent with what has already been emitted, so cross-
            # chunk newlines cannot re-form a multi-blank run after release.
            buffer = _EXCESS_BLANK_RE.sub("\n\n", buffer)
            # Strip a complete self-grade sentinel and capture its value so it
            # never reaches the user (or the downstream translation pipeline).
            if LLM_SELF_CONFIDENCE_ENABLED:
                buffer, _sc = _extract_self_confidence(buffer)
                if _sc is not None:
                    self_confidence = _sc
                # The sentinel is a VARIABLE pattern [[CONF:<digits>]]; a chunk
                # boundary landing after digits or a closing bracket leaves a tail
                # that is not a prefix of the literal "[[CONF:" (so the fixed-marker
                # tail check misses it) and would leak. Withhold any in-progress
                # sentinel so it is stitched, not emitted.
                pm = _SELF_CONF_PARTIAL_RE.search(buffer)
                partial_tail = len(buffer) - pm.start() if pm else 0
            else:
                partial_tail = 0
            tail = max(_streaming_marker_tail_len(buffer), partial_tail)
            if tail >= len(buffer):
                # Whole buffer is a potential partial marker (or trailing
                # whitespace lead-in) — withhold until more input arrives.
                continue
            if tail:
                emit, buffer = buffer[:-tail], buffer[-tail:]
            else:
                emit, buffer = buffer, ""
            if emit:
                yield f"data: {emit.encode('utf-8')!r}\n\n"

        # Flush whatever remains (final pass: a partial marker that never completed
        # is real content and must be emitted, not dropped).
        if buffer:
            buffer = _CONV_SEP_RE.sub("\n", buffer)
            buffer = _CONV_ROLE_RE.sub("", buffer)
            buffer = _EXCESS_BLANK_RE.sub("\n\n", buffer)
            if LLM_SELF_CONFIDENCE_ENABLED:
                # Capture any sentinel that completed on the final chunk, and drop
                # a malformed trailing partial sentinel so it never leaks as text.
                buffer, _sc = _extract_self_confidence(buffer)
                if _sc is not None:
                    self_confidence = _sc
                buffer = _SELF_CONF_PARTIAL_RE.sub("", buffer)
            if buffer:
                yield f"data: {buffer.encode('utf-8')!r}\n\n"

        # Compute metadata after tokens so TTFT is unaffected by the doc-metadata fetches.
        source_documents, retrieval_confidence, is_grounded = await self._assemble_source_documents(
            result_dict, token=token, include_contexts=include_contexts
        )
        _cs = round(
            _display_confidence(retrieval_confidence, self_confidence)
            if LLM_SELF_CONFIDENCE_ENABLED
            else retrieval_confidence,
            2,
        )
        logger.debug(
            f"Streaming confidence emission: retrieval={retrieval_confidence} "
            f"self={self_confidence} self_conf_enabled={LLM_SELF_CONFIDENCE_ENABLED} "
            f"-> confidence_score={_cs}"
        )
        # The abstention outcome was derived once in handle_request (it also
        # drove the metric), so this event and the counter cannot disagree.
        # Every input of the answer-level outcome is known here, so this is the
        # first point at which the span can be recorded. `sentinel_present`
        # reports whether a self-grade was actually parsed, so an operator can
        # tell "no self-grade requested" from "requested and never completed".
        _emit_stream_outcome_span(
            parent_context=parent_context,
            retrieval_confidence=retrieval_confidence,
            self_confidence=self_confidence,
            is_grounded=is_grounded,
            sentinel_present=self_confidence is not None,
            abstained=abstained,
            abstention_reason=abstention_reason,
        )
        metadata = {
            "type": "metadata",
            "source_documents": source_documents,
            # The labels the retrieval filtered on (empty when the query was
            # unfiltered), so an operator sees the scope behind an abstention.
            "filter_labels": list(filter_labels or []),
            # Raw retrieval confidence (rank-weighted) — always present for admin/eval.
            "retrieval_confidence_score": round(retrieval_confidence, 2),
            # Citizen-facing: the LLM self-grade when the feature is on (fallback to
            # retrieval so the badge never disappears), else the retrieval confidence.
            # Same _cs the debug log above reports, so the log cannot claim a
            # different value than what clients received.
            "confidence_score": _cs,
            "is_grounded": is_grounded,
        }
        if query_translation_status is not None:
            # Always set by handle_request (every turn knows what its embedder
            # was fed); omitted only when the helper is driven standalone.
            metadata["query_translation_status"] = query_translation_status
        if abstained:
            _mark_abstention(metadata, abstention_reason)
        if LLM_SELF_CONFIDENCE_ENABLED:
            # Raw LLM self-assessed groundedness; None when the sentinel was
            # omitted/malformed. Never hard-fails the chat.
            metadata["self_confidence"] = round(self_confidence, 2) if self_confidence is not None else None
        yield "data: " + json.dumps(metadata) + "\n\n"
        yield "data: [DONE]\n\n"

    @staticmethod
    def _extract_sse_content(text: str) -> str | None:
        """Decode the text payload of a ``data: b'...'`` SSE chunk.

        Returns ``None`` if the chunk is not in the expected bytes-repr format so
        the caller can forward it verbatim (an unexpected orchestrator format must
        never break the stream). The orchestrator's ``align_generator`` emits every
        token chunk as ``data: {repr(content.encode('utf-8'))}\\n\\n``.
        """
        if not (text.startswith("data: ") and text.endswith("\n\n")):
            return None
        payload = text[len("data: ") : -2]
        if not (payload.startswith("b'") or payload.startswith('b"')):
            return None
        try:
            raw = ast.literal_eval(payload)
        except (ValueError, SyntaxError):
            return None
        if not isinstance(raw, (bytes, bytearray)):
            return None
        return raw.decode("utf-8", errors="replace")

    def _build_rag_graph(self, include_rerank: bool = True, llm_endpoint: str | None = None):
        """Build the RAG service graph (embedding → retriever → [rerank] → llm).

        Single consolidated graph builder replacing the 5 near-duplicate
        ``add_remote_service*`` variants (Story 1.4 pre-rebase cleanup). The only
        real axes of variation are: (a) whether the rerank node is present, and
        (b) the LLM endpoint (default ``/v1/chat/completions``; ``/v1/faqgen``
        for the FAQ mode). The graph is otherwise identical across all modes.
        """
        llm_endpoint = llm_endpoint or f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions"

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        services = [embedding, retriever]
        edges = [(embedding, retriever)]

        if include_rerank:
            rerank = MicroService(
                name="rerank",
                host=RERANK_SERVER_HOST_IP,
                port=RERANK_SERVER_PORT,
                endpoint="/v1/reranking",
                use_remote_service=True,
                service_type=ServiceType.RERANK,
            )
            services.append(rerank)
            edges.append((retriever, rerank))
            previous = rerank
        else:
            previous = retriever

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=llm_endpoint,
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        services.append(llm)
        edges.append((previous, llm))

        for service in services:
            self.megaservice.add(service)
        for src, dst in edges:
            self.megaservice.flow_to(src, dst)

    def add_remote_service(self):
        """Full RAG graph: embedding → retriever → rerank → llm (chat/completions)."""
        self._build_rag_graph(include_rerank=True)

    def add_remote_service_without_rerank(self):
        """RAG graph without the rerank node: embedding → retriever → llm."""
        self._build_rag_graph(include_rerank=False)

    def add_remote_service_faqgen(self):
        """Full RAG graph with the FAQ LLM endpoint: embedding → retriever → rerank → llm (faqgen)."""
        self._build_rag_graph(include_rerank=True, llm_endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/faqgen")

    def add_remote_service_without_translation(self):
        """Alias of :meth:`add_remote_service` (the full graph) — kept for CLI/test compat.

        The ``without_translation`` name predates the consolidation; GENIE's
        translation happens in the chat handler, not as a graph node, so this
        mode builds the same full graph as the default.
        """
        self.add_remote_service()

    def add_remote_service_genieai(self):
        """Alias of :meth:`add_remote_service` (the full graph) — kept for CLI/test compat."""
        self.add_remote_service()

    @staticmethod
    def _build_translategemma_prompt(
        text: str,
        source_lang_code: str,
        target_lang_code: str,
    ) -> str:
        """Build a prompt for TranslateGemma using the completions API.

        The language names and the scripts come from the shipped tables, so
        nothing that is not a language reaches the prompt. A code the map does
        not know is not a language: the target falls back to English, and the
        SOURCE is not named at all — the prompt then asks for a translation
        into the target without claiming to know what the source is. That is
        the case the history hits when the detector answers with a code the
        map does not key ('zh-cn', 'jw', 'tl'): the history is still
        normalized to English, but no raw code is written into the prompt.

        The script clause follows the target: a target written in the Latin
        alphabet is asked for the Latin alphabet, and a target written in
        another script is asked for that one. A source written in a script
        the target does not use is named as well, so the model does not
        answer in the script it was given.
        """
        language_codes = language_codes_map()
        scripts = language_scripts_map()

        target_code = str(target_lang_code).strip().lower()
        if not _LANGUAGE_CODE_PATTERN.match(target_code) or target_code not in language_codes:
            logger.warning(
                f"Target language '{_language_display(target_lang_code)}' is not a known language — using English."
            )
            target_code = "en"
        target_name = language_codes[target_code]

        # The source is named only when the map knows it. A code the map does
        # not key is not a language the service knows, and naming it would put
        # a raw code where a language belongs.
        source_code = str(source_lang_code).strip().lower()
        source_name = None
        if not _LANGUAGE_CODE_PATTERN.match(source_code):
            logger.warning(
                f"Source language '{_language_display(source_lang_code)}' is not a language code — not naming a source."
            )
        elif source_code not in language_codes:
            logger.warning(
                f"Source language '{_language_display(source_lang_code)}' is not in the language map"
                " — not naming a source."
            )
        else:
            source_name = language_codes[source_code]

        target_script = scripts.get(target_code)
        source_script = scripts.get(source_code) if source_name else None
        script_clause = ""
        if target_script == "Latn":
            script_clause = "Write the translation in the Latin alphabet only, and do not use any other script. "
        elif target_script:
            script_clause = (
                f"Write the translation in {target_name}, "
                f"using the {_SCRIPT_NAMES.get(target_script, target_script)} script. "
            )
        if source_script and source_script != "Latn" and source_script != target_script:
            script_clause += (
                f"Do not reproduce the source text in the {_SCRIPT_NAMES.get(source_script, source_script)} script. "
            )

        if source_name:
            role = f"a professional {source_name} ({source_code}) to {target_name} ({target_code}) translator"
            source_text = f"the original {source_name} text"
            not_output = f"Do NOT output in {source_name} or in any other language."
            request = f"Please translate the following {source_name} text into {target_name}"
        else:
            role = f"a professional translator into {target_name} ({target_code})"
            source_text = "the original text"
            not_output = "Do NOT output in any other language."
            request = f"Please translate the following text into {target_name}"

        return (
            f"<bos><start_of_turn>user\n"
            f"You are {role}. Your goal is to "
            f"accurately convey the meaning and nuances of {source_text} "
            f"while adhering to {target_name} grammar, vocabulary, and cultural "
            f"sensitivities.\n"
            f"CRITICAL: You MUST output ONLY in {target_name} ({target_code}). "
            f"{not_output} "
            f"{script_clause}\n"
            f"Produce only the {target_name} translation, without any additional "
            f"explanations or commentary. {request}:\n\n\n{text}"
            f"<end_of_turn>\n<start_of_turn>model\n"
        )

    def _translation_output_cap(self, flattened_history_string: str) -> int | None:
        """Completion cap for the TranslateGemma payload.

        Base ceiling is len//2 (bounded 512..4096). When the translation window
        is discovered, the cap is clamped so the prompt estimate (chars /
        chars-per-token ratio) plus the completion stays inside the window —
        otherwise vLLM rejects the whole request and the history goes back
        untranslated. Returns None when the clamped cap drops below the
        estimated input size (the completion would be shorter than what there
        is to translate); the caller should skip the translation and send the
        history as-is.
        """
        cap = _translation_base_cap(flattened_history_string)
        window = _get_translation_window()
        if window:
            prompt_token_estimate = len(flattened_history_string) // TRANSLATION_CHARS_PER_TOKEN
            cap = min(cap, max(1, window - TRANSLATION_PROMPT_OVERHEAD_TOKENS - prompt_token_estimate))
            if cap < prompt_token_estimate:
                return None
        return cap

    async def _get_translated_history_string(
        self, history: list | str, source_lang_code: str = "en"
    ) -> tuple[str, str]:
        """
        A helper that:
        1. Truncates history to stay within a token limit.
        2. Flattens the history into a single string.
        3. Sends the string to the translation LLM.

        Automatically uses TranslateGemma structured format or generic prompt format
        based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            history: Chat history as list of dicts or plain string (single-message mode).
            source_lang_code: Source ISO language code (e.g. "st") for TranslateGemma.

        The target is not a parameter: the history is normalized to English,
        the language of the embedding space, whatever the caller asked for.
        The name the prompt carries comes from the language map, so a caller
        cannot put free text in the prompt, and a map that does not know
        English leaves the history as it is.

        Returns:
            ``(text, status)``. The text is safe to hand to the embedder:
            the translated English history, or — when the translation could
            not run — the flattened source-language history. The one
            exception is a history whose newest message alone exceeds the
            whole budget: there is no source text to fall back to, so the
            text is empty and the retrieval query is empty with it. The
            status tells the caller which one it was:
            ``"translated"`` when the history came back in English,
            ``"fallback_timeout"`` when the translation service timed out,
            and ``"fallback_error"`` when it failed or refused for any other
            reason (window too tight, unreadable language map, nothing fit
            the budget, empty completion). The history is normalized for the
            retriever and never shown to the user, so the turn is not failed
            on a fallback — but the fallback is never silent: the caller
            stamps the status on the ``chatqna.orchestrate`` span and into
            the response metadata, so a degraded translation service is
            visible where the retrieval quality it degrades is diagnosed.
            The passthrough cases never reach this method: the caller
            classifies them itself (``"passthrough_english"`` when the
            history is established English, ``"passthrough_unknown_language"``
            when no language could be established for it).
        """
        # Single-message mode sends history as a plain string
        if isinstance(history, str):
            flattened_history_string = history
        else:
            max_translation_chars = _get_max_translation_chars()
            current_chars = 0
            messages_to_process = []
            if logflag:
                logger.debug(f"Processing translation for history with {len(history)} messages.")

            for message in reversed(history):
                if logflag:
                    logger.debug(f"Examining message: {message}")
                # .get, not [:]: request validation permits a message with no
                # content key, and a malformed message must not crash the
                # turn — it counts as empty, exactly as the flatten below
                # reads it.
                message_chars = len(message.get("content", ""))
                if current_chars + message_chars + TRANSLATION_MSG_OVERHEAD_CHARS > max_translation_chars:
                    break
                messages_to_process.append(message)
                current_chars += message_chars + TRANSLATION_MSG_OVERHEAD_CHARS
            messages_to_process.reverse()
            dropped_messages = len(history) - len(messages_to_process)
            if dropped_messages:
                history_truncation_total.add(1, {"path": "translation"})
                logger.warning(
                    "Chat history truncated for translation: budget_chars=%s kept_messages=%s dropped_messages=%s",
                    max_translation_chars,
                    len(messages_to_process),
                    dropped_messages,
                )
            if not messages_to_process:
                # Even the newest message exceeds the whole budget: nothing to
                # translate — sending an empty prompt would only harvest the
                # model's junk reply as chat history.
                return "", _QUERY_FALLBACK_ERROR

            flattened_history_string = _flatten_history_string(messages_to_process)

        # The target steers the prompt, so it is resolved against the language
        # map — ONCE, for both shapes of the history. The target is English:
        # the history is normalized to the language of the embedding space,
        # not to the language the caller asked for.
        language_codes = language_codes_map()
        canonical_target = HISTORY_TRANSLATION_TARGET
        target_name = language_codes.get(canonical_target)
        if target_name is None:
            logger.warning("The language map does not know English — refusing to translate the history.")
            return flattened_history_string, _QUERY_FALLBACK_ERROR

        # Single-message mode sends history as a plain string — translate it.
        # The chunk translator is bypassed on purpose: it swallows a failed
        # chunk into the source text, and this caller has to know the
        # translation did not happen (it reports the status, unlike the
        # answer path where the swallowed fallback is the contract). The
        # chunk translator classifies its failures into typed exceptions, so
        # the split here is isinstance-only. Overflow still propagates
        # fail-loud — but note that on this path nothing maps it to the #829
        # 422 contract: it escapes handle_request as an unhandled 500.
        if isinstance(history, str):
            try:
                return (
                    await self._translate_chunk_in_language(
                        history, canonical_target, target_name, source_lang_code=source_lang_code
                    ),
                    _QUERY_TRANSLATED,
                )
            except TranslationTimeoutError:
                # Already logged by the chunk translator's wrap site (the one
                # line that names the timeout); the status is the observable.
                return history, _QUERY_FALLBACK_TIMEOUT
            except TranslationFailedError as e:
                logger.error(f"History translation failed: {e}")
                return history, _QUERY_FALLBACK_ERROR

        # One derivation per call: the payload, the log line and the response
        # parse must branch on the SAME decision (and the same id).
        translation_model_id = _get_translation_model_id()
        translategemma = _is_translategemma(translation_model_id)
        # Build payload based on model type
        if translategemma:
            # Use completions API with pre-formatted prompt (vLLM v0.10.0 cannot
            # pass structured content through chat completions to TranslateGemma's template)
            prompt = self._build_translategemma_prompt(
                text=flattened_history_string,
                source_lang_code=source_lang_code,
                target_lang_code=canonical_target,
            )
            output_cap = self._translation_output_cap(flattened_history_string)
            if output_cap is None:
                logger.warning(
                    "Translation window too tight to translate the history meaningfully; returning it untranslated"
                )
                return flattened_history_string, _QUERY_FALLBACK_ERROR
            payload = {
                "model": translation_model_id,
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": output_cap,
                "repetition_penalty": 1.2,
            }
            url = TRANSLATION_COMPLETIONS_URL
        else:
            prompt = (
                f"Translate the following chat history to {target_name}. "
                f"Preserve the role markers (e.g., 'USER:', 'ASSISTANT:')."
                f"\n\nHISTORY:\n{flattened_history_string}"
            )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            svc = "TranslateGemma" if translategemma else "generic"
            logger.debug(f"Payload for translation service ({svc}): {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                response.raise_for_status()
                response_data = response.json()
                if translategemma:
                    translated_blob = response_data["choices"][0]["text"]
                else:
                    translated_blob = response_data["choices"][0]["message"]["content"]
                translated_blob = translated_blob.strip()
                if not translated_blob:
                    # A 200 with an empty completion is a failure, not a
                    # translation: the chunk translator refuses it for the
                    # same reason (an empty history would silently blank the
                    # retrieval query), and the fallback status says so.
                    logger.error("Translation model returned an empty history translation; using the source.")
                    return flattened_history_string, _QUERY_FALLBACK_ERROR
                if logflag:
                    logger.debug(f"Translated chat history: {translated_blob}")
                return translated_blob, _QUERY_TRANSLATED

        except (httpx.TimeoutException, TimeoutError) as e:
            logger.error(
                f"History translation timeout after "
                f"{TRANSLATION_SERVICE_TIMEOUT} seconds. Returning history "
                f"in original language. Error: {e}"
            )
            return flattened_history_string, _QUERY_FALLBACK_TIMEOUT
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return flattened_history_string, _QUERY_FALLBACK_ERROR

    async def _condense_query(self, history_text: str, last_message: str) -> str:
        """Rewrite a follow-up into a standalone retrieval query (issue #1091).

        One short LLM call against the chat LLM's endpoint/model
        (temperature 0, guided JSON, fail-closed timeout via
        MULTI_TURN_CONDENSE_TIMEOUT_SECONDS, no retry). Fail-closed:
        every failure classification raises HTTPException(503) — the turn
        fails with LLM-failure semantics; retrieval never sees the raw or
        blended query on this path.
        """
        url = (
            f"{LLM_SERVER_PROTOCOL}://{LLM_SERVER_HOST_IP}:{LLM_SERVER_PORT}"
            f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions"
        )
        system_prompt = os.getenv("MULTI_TURN_CONDENSE_SYSTEM_PROMPT", "").strip() or _CONDENSE_SYSTEM_PROMPT
        tracer = get_tracer("chatqna.query_condense")
        _start = time.monotonic()
        with tracer.start_as_current_span("chatqna.query_condense") as span:
            try:
                # Inside the classified try: building the payload calls
                # _get_llm_model(), which raises ModelDiscoveryError when the
                # endpoint answers nothing — that must surface as the same
                # fail-closed 503 as every other condense failure, not as an
                # unclassified 500 that bypasses the caller's metrics.
                payload = {
                    "model": _get_llm_model(),
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": _build_condense_user_content(history_text, last_message)},
                    ],
                    "temperature": 0.0,
                    "max_tokens": _CONDENSE_MAX_TOKENS,
                    "response_format": {"type": "json_object"},
                    "stream": False,
                }
                async with httpx.AsyncClient(timeout=_CONDENSE_TIMEOUT_SECONDS) as client:
                    response = await client.post(
                        url, json=payload, headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}
                    )
                    response.raise_for_status()
                    try:
                        body = response.json()
                    except json.JSONDecodeError as e:
                        # 200 with a non-JSON body — classified, not escaped
                        # (spec failure-classification item 3).
                        raise CondenseError("bad_body", f"non-JSON body: {str(e)[:120]}") from e
                try:
                    content = body["choices"][0]["message"]["content"]
                except (KeyError, IndexError, TypeError) as e:
                    raise CondenseError("missing_field", f"unexpected response shape: {str(body)[:120]}") from e
                standalone_query = _parse_condense_response(content)
                usage = body.get("usage") or {}
                # String/enum attrs go through sanitize_attributes; the two
                # token counters are emitted via raw set_attribute — the
                # PII regex (tracing._PII_KEY_PATTERNS, key "token" →
                # match) would otherwise drop them, and they carry no PII
                # (integer counts only). Repo precedent: dataprep emits
                # `dataprep.llm.prompt_tokens` / `completion_tokens` via raw
                # `span.set_attribute` for exactly this reason.
                _condense_span_attrs(span, "ok", round((time.monotonic() - _start) * 1000))
                span.set_attribute("genie.condense.prompt_tokens", usage.get("prompt_tokens", 0))
                span.set_attribute("genie.condense.completion_tokens", usage.get("completion_tokens", 0))
                logger.debug(f"Condense rewrite ok: {standalone_query}")
                return standalone_query
            except (CondenseError, ModelDiscoveryError, httpx.TimeoutException, httpx.HTTPError) as e:
                if isinstance(e, CondenseError):
                    reason = e.reason
                elif isinstance(e, ModelDiscoveryError):
                    reason = "model_discovery"
                elif isinstance(e, httpx.TimeoutException):
                    reason = "timeout"
                else:
                    reason = "http_error"
                _condense_span_attrs(span, "failed", round((time.monotonic() - _start) * 1000))
                logger.warning(f"Condense rewrite failed ({reason}): {type(e).__name__}: {e}")
                _raise_condense_503(reason, e)

    def _resolve_request_language(self, raw_language) -> tuple[str | None, bool]:
        """The language a request asks for, and whether that language was refused.

        The language travels in the request body, so it is caller-controlled:
        only a code the map knows may steer the translator. An unknown code is
        refused — the answer stays in English — instead of being interpolated
        into a translation prompt.

        Returns ``(language, refused)``:

        - ``(code, False)`` — the request asked for a language the map knows.
        - ``(None, False)`` — the request asked for no language at all: the
          caller falls back to language detection.
        - ``(None, True)`` — the request asked for a language the map does not
          know. The language is refused: it does not steer the answer, and the
          caller detects the conversation's own language for the history
          instead of trusting a code it just refused.
        """
        resolved = _resolve_language_code(raw_language, language_codes_map())
        if resolved is not None:
            return resolved, False
        if raw_language is None or (isinstance(raw_language, str) and raw_language.strip().lower() in ("", "auto")):
            # No language asked for: the caller falls back to detection.
            return None, False
        logger.warning(
            f"Requested language '{_language_display(raw_language)}' is not a known language code — "
            "translation is refused and the answer stays in English."
        )
        return None, True

    def _split_text_into_chunks(self, text: str, max_chars: int = 2000) -> list:
        """Split text into chunks, trying to break at sentence boundaries."""
        if len(text) <= max_chars:
            return [text]

        chunks = []
        current_chunk = ""
        sentences = text.replace("\n\n", "\n").split(". ")

        for sentence in sentences:
            if len(current_chunk) + len(sentence) + 2 <= max_chars:
                current_chunk += sentence + ". "
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence + ". "

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    async def _translate_chunk_in_language(
        self,
        text: str,
        canonical_code: str,
        target_lang: str,
        source_lang_code: str = "en",
    ) -> str:
        """Translate a chunk into a language that has already been resolved.

        The caller has already checked the target against the language map, so
        this hop builds the prompt and sends it — nothing here resolves a
        language, and nothing here can refuse one. A document is translated
        chunk by chunk, and the language is resolved once for the whole
        document: the chunks of one answer cannot disagree about the language
        they are written in, and a refusal is logged once instead of once per
        chunk.

        A chunk that could not be translated raises ``TranslationFailedError``:
        the answer is either translated or it is not, and a chunk that goes
        through in English leaves an answer that is neither.

        Args:
            text: The chunk to translate.
            canonical_code: The canonical target code the language map knows.
            target_lang: The language name the map gives for that code.
            source_lang_code: Source ISO language code (e.g. "en"). Defaults to "en".
        """
        # One derivation per call: the payload, the log line and the response
        # parse all branch on this single read.
        translation_model_id = _get_translation_model_id()
        translategemma = _is_translategemma(translation_model_id)
        if translategemma:
            target_lang_code = canonical_code
            prompt = self._build_translategemma_prompt(
                text=text,
                source_lang_code=source_lang_code,
                target_lang_code=target_lang_code,
            )
            payload = {
                "model": translation_model_id,
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": _translation_base_cap(text),
                "repetition_penalty": 1.2,
            }
            url = TRANSLATION_COMPLETIONS_URL
        else:
            language_notes = {
                "Sesotho": "NOTE: Sesotho is spoken in Lesotho and South Africa. It is NOT Afrikaans.",
                "Bengali": "NOTE: Bengali is spoken in Bangladesh and India. It is NOT Hindi.",
                "Mandinka": "NOTE: Mandinka is spoken in West Africa (Gambia, Senegal, Mali).",
            }
            note = language_notes.get(target_lang, "")
            prompt = (
                f"Translate the following text to {target_lang} "
                f"(ISO 639-1 code: {canonical_code}). {note} "
                f"Only output the translated text, nothing else."
                f"\n\nText: {text}\n\nTranslation:"
            )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            logger.debug(f"Translation payload ({'TranslateGemma' if translategemma else 'generic'}): {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                response.raise_for_status()
                response_data = response.json()
                if translategemma:
                    translated = response_data["choices"][0]["text"].strip()
                else:
                    translated = response_data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            # Fail-loud on vLLM context overflow: silently returning the
            # original English text breaks the multilingual UX (#829). Classify
            # by the HTTP body / error text and raise TranslationInputTooLongError
            # so the route layer maps this to a 422 the BFF can surface.
            from dataprep.genieai_dataprep_arangodb import _is_vllm_input_overflow

            if _is_vllm_input_overflow(e):
                logger.warning(f"Translation context overflow: {type(e).__name__}: {str(e)[:200]}")
                raise TranslationInputTooLongError(
                    f"translation chunk exceeds VLLM_TRANSLATION_MAX_MODEL_LEN: {type(e).__name__}: {str(e)[:200]}"
                ) from e
            if isinstance(e, (httpx.TimeoutException, TimeoutError)):
                # One typed subtype: the answer path still sees a
                # TranslationFailedError, while the history path reports
                # "the service was slow" without unwrapping __cause__.
                logger.warning(f"Translation chunk timed out after {TRANSLATION_SERVICE_TIMEOUT} seconds.")
                raise TranslationTimeoutError(f"translation chunk timed out: {type(e).__name__}: {str(e)[:200]}") from e
            logger.warning(f"Failed to translate chunk: {type(e).__name__}: {e}")
            raise TranslationFailedError(f"translation chunk failed: {type(e).__name__}: {str(e)[:200]}") from e

        if not translated and text.strip():
            # The model answered with nothing. The chunk would join the answer
            # as a hole, and the answer would read as a translation that is
            # missing a section.
            raise TranslationFailedError("translation model returned an empty translation for a non-empty chunk")

        return translated

    async def _translate_with_chunking(self, text: str, iso_code: str, source_lang_code: str = "en") -> str:
        """Translate long text by splitting into chunks and translating separately.

        The target language is checked against the language map before the
        first chunk is sent: an unknown code is refused as a whole, so an
        answer is never a mix of translated and untranslated chunks. A chunk
        that could not be translated fails the whole answer, for the same
        reason: an answer that is half translated is not an answer in the
        requested language.
        """
        language_codes = language_codes_map()
        canonical_code, target_lang = _canonical_target_language(iso_code, language_codes)
        if canonical_code is None:
            return text

        chunks = self._split_text_into_chunks(text, max_chars=2000)

        if logflag:
            logger.info(f"Translating {len(text)} chars in {len(chunks)} chunks to {target_lang}")

        # The language was resolved once for the whole document: every chunk
        # is written in the language the map named.
        translated_chunks = await asyncio.gather(
            *[
                self._translate_chunk_in_language(
                    chunk,
                    canonical_code,
                    target_lang,
                    source_lang_code=source_lang_code,
                )
                for chunk in chunks
            ],
            # Every chunk is awaited before the answer fails: a chunk that is
            # still in flight when the answer is abandoned would report an
            # exception nobody retrieved.
            return_exceptions=True,
        )

        for outcome in translated_chunks:
            if isinstance(outcome, BaseException):
                if isinstance(outcome, TranslationInputTooLongError):
                    # A permanent contract issue (the chunk exceeds the model
                    # window): the route layer maps it to a 422.
                    raise outcome
                raise TranslationFailedError(
                    f"translation chunk failed: {type(outcome).__name__}: {outcome}"
                ) from outcome

        return " ".join(translated_chunks)

    async def handle_request(self, request: Request):
        # Auth gate runs first (before body parse) so unauthenticated requests
        # cost only a header lookup. Bearer scheme is case-insensitive per RFC 7235.
        authorization = request.headers.get("Authorization")
        if not authorization:
            logger.warning("No Authorization header in request — rejecting")
            raise HTTPException(
                status_code=401,
                detail="Missing or malformed Authorization header. All chatqna calls must be authenticated.",
            )
        scheme, _, token_str = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token_str.strip():
            logger.warning("Authorization header is not a Bearer token — rejecting")
            raise HTTPException(status_code=401, detail="Authorization header must use the Bearer scheme.")
        token_str = token_str.strip()

        # Validate token signature via Keycloak JWKS. Distinguish
        # IdP-outage (JwksUnavailableError → 503) from invalid-token
        # (None → 401) — previously both surfaced as identical 401s,
        # masking Keycloak availability problems from operator dashboards.
        try:
            claims = await validate_token(token_str)
        except JwksUnavailableError as exc:
            logger.error(f"Keycloak JWKS unavailable: {exc}")
            raise HTTPException(status_code=503, detail="Authentication provider unavailable") from exc
        if claims is None:
            logger.warning("Incoming Bearer token failed JWKS validation — rejecting request")
            raise HTTPException(status_code=401, detail="Token validation failed")

        data = await request.json()

        # --- LOGGING THE FULL REQUEST FROM THE FRONTEND FOR DEBUGGING---
        logger.debug(f"\n\nFRONTEND PAYLOAD: \n{data}\n\n")

        # Validate the chat body before any outbound enrichment calls so a malformed
        # payload cannot trigger an HTTP round-trip to the backend.
        chat_request = ChatCompletionRequest.model_validate(data)

        user_details = {}
        try:
            user_details = await self.user_profile_client.get_user_profile(token=token_str)
        except Exception as e:
            logger.error(f"USER PROFILE ERROR: {e}")

        # --- LOGGING FOR DEBUGGING CHAT REQUEST ---
        logger.debug(f"Parsed chat request: {chat_request}")

        retrieval_context = {}

        if chat_request.context:
            try:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
        logger.debug(f"Context keys: {list(retrieval_context.keys())}")
        # -----------------------------------------------

        if logflag:
            logger.debug(f"Incoming Chat Request: {chat_request}")

        full_chat_history = chat_request.messages
        # Check both context.language and the direct language field
        raw_language = None
        if chat_request.context and chat_request.context.language:
            raw_language = chat_request.context.language
        elif chat_request.language and chat_request.language != "auto":
            raw_language = chat_request.language

        # The language comes from the request body, so it is caller-controlled:
        # an unknown code is refused and the answer stays in English.
        original_language, language_refused = self._resolve_request_language(raw_language)

        if logflag:
            logger.info(
                f"Language from frontend - requested: '{_language_display(raw_language)}', "
                f"resolved: {original_language}"
            )

        # The language the conversation is written in, as opposed to the
        # language the answer is written in. They differ when the request asks
        # for a language that was refused: the answer stays in English, but the
        # history is still normalized to English for the retriever.
        detected_language = None

        # Re-enabled language detection as fallback ---
        try:
            if logflag:
                logger.info(
                    f"Language detection check - original_language is None: "
                    f"{original_language is None}, is empty string: "
                    f"{original_language == '' if original_language else 'N/A'}"
                )

            if language_refused or not original_language or original_language.strip() == "":
                if logflag:
                    logger.info("Triggering auto-detection because original_language is falsy or empty")

                # Attempt to detect language from the last user message
                last_user_content = ""
                if isinstance(full_chat_history, str):
                    last_user_content = full_chat_history
                else:
                    for msg in reversed(full_chat_history):
                        if msg.get("role") == "user":
                            last_user_content = msg.get("content", "")
                            break

                if logflag:
                    logger.info(
                        f"Last user content for detection (first 100 chars): "
                        f"{last_user_content[:100] if last_user_content else 'None'}"
                    )

                if last_user_content:
                    detected_lang = detect(last_user_content)
                    if logflag:
                        logger.info(
                            f"langdetect result: '{detected_lang}' "
                            f"(will convert to uppercase: '{detected_lang.upper()}')"
                        )

                    # Load supported languages to validate the detection
                    language_codes = language_codes_map()

                    # The detected code is the server's own answer to "what
                    # language is this text in": a bounded ISO code from
                    # langdetect, never text the caller supplied. It is kept
                    # even when the translation models do not cover it, because
                    # the history still has to be normalized to English for the
                    # English-only embedding space.
                    detected_language = detected_lang.upper() if detected_lang else None

                    # The answer is written in the detected language only when
                    # the translation models cover it.
                    is_supported = detected_lang and (
                        detected_lang.lower() in language_codes or detected_lang.lower() == "en"
                    )

                    if logflag:
                        logger.info(
                            f"Language validation - detected '{detected_lang}', "
                            f"supported: {is_supported}, in language_codes: "
                            f"{detected_lang.lower() in language_codes if detected_lang else 'N/A'}"
                        )

                    if is_supported:
                        if detected_language != "EN":
                            original_language = detected_language
                            logger.info(f"Auto-detected language: {original_language}")
                    else:
                        msg = (
                            f"Detected language '{detected_lang}' is not in "
                            "supported languages list. Ignoring auto-detection. "
                            "Falling back to EN."
                        )
                        logger.warning(msg)
                        original_language = "EN"
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            # Fallback to English if detection fails
            if not original_language:
                original_language = "EN"

        if language_refused:
            # A refused language does not steer the answer: it stays in English.
            original_language = "EN"

        # The language the history is written in. The detection's answer wins
        # whenever there is one: it is what the conversation is actually
        # written in, and the history has to be normalized to English for the
        # English-only embedding space. A code the map does not key ('zh-cn')
        # names the source all the same — the prompt does not name it, but the
        # history is translated to English regardless. Without a detected code
        # the requested language is the only one there is, and when there is
        # neither there is no source to translate from: the history is
        # embedded as it is.
        history_language = detected_language or original_language

        translated_history_string = ""
        # What the embedder will be fed: a translated query, the English
        # source passed through, or — when the history translator fell back —
        # the untranslated source language. The fallback does not fail the
        # turn (the history is normalized for the retriever, never shown),
        # but it is never silent: this status is stamped on the
        # chatqna.orchestrate span and into the response metadata, so a
        # degraded translation microservice shows up where the retrieval
        # quality it degrades is diagnosed (issue #1026).
        query_translation_status = None
        if history_language and history_language.strip() != "EN":
            if logflag:
                logger.debug(
                    f"Original language detected: {history_language}. Proceeding with translation of chat history."
                )
            translated_history_string, query_translation_status = await self._get_translated_history_string(
                full_chat_history, source_lang_code=history_language.lower()
            )
        else:
            # A passthrough is only "English" when something actually
            # established English: the request named it (and the code was
            # not refused), or detection concluded it. A fabricated fallback
            # — no language given and none detected, a crashed detection, a
            # refused request code — is reported as unknown, so the runbook
            # filter cannot mistake an arbitrary-language query for an
            # English one.
            english_established = detected_language == "EN" or (
                original_language == "EN" and not language_refused and bool(raw_language)
            )
            query_translation_status = _QUERY_PASSTHROUGH_EN if english_established else _QUERY_PASSTHROUGH_UNKNOWN
            # Already English, or no source language to translate from:
            # flatten without translation. Same recipe as the translator's
            # flatten, so the two differ only in the words.
            if isinstance(full_chat_history, str):
                translated_history_string = full_chat_history
            else:
                translated_history_string = _flatten_history_string(full_chat_history)

        if logflag:
            logger.debug(f"Translated History String: {translated_history_string}")

        # RegEx-based extraction for last user message in the array
        last_translated_message_content = ""
        user_messages = USER_MSG_PATTERN.findall(translated_history_string)
        if user_messages:
            last_translated_message_content = user_messages[-1].strip()

        # If regex fails for some reason, we have a simple fallback
        if not last_translated_message_content:
            # Fallback to just using the whole blob (less accurate for retrieval but safe)
            last_translated_message_content = translated_history_string

        if logflag:
            logger.debug(f"Last_translated_message_content: {last_translated_message_content}")

        # Multi-turn retrieval query resolution (issue #1091):
        #   - blend (default): issue-#833 vector-space blending, unchanged.
        #   - condense: one short LLM call rewrites the follow-up into a
        #     standalone query; retrieval AND rerank use the rewritten query
        #     (fail-closed: a failed rewrite fails the turn — 503, no
        #     blend/raw-query fallback). condense overrides the blend flag.
        retrieval_query = last_translated_message_content
        history_text = ""
        # Built incrementally so the condense-rewrite branch can splice in
        # ``condense_raw_query`` (see below) before the schedule call. The
        # remaining keys are filled in once the retriever/reranker
        # parameters are constructed further down.
        genie_params = {
            "full_chat_history_string": translated_history_string,
            "original_language": original_language,
            "user_details": user_details,
        }
        # Blend resolution is mutually exclusive with condense mode, so neither
        # branch of the chain below may leave these unset: the span attributes
        # further down read them on every request.
        _blend_enabled, _blend_alpha, _blend_turns = False, None, 0
        if MULTI_TURN_MODE == "condense":
            if MULTI_TURN_BLEND_ENABLED:
                logger.warning(
                    "MULTI_TURN_MODE=condense overrides MULTI_TURN_BLEND_ENABLED=true — "
                    "vector-space blending is ignored while condense mode is active."
                )
            condense_history = _extract_history_text(translated_history_string, MULTI_TURN_CONDENSE_HISTORY_TURNS)
            if condense_history:
                # Condense-failed 503 turns must still surface on the same
                # chat_requests_total / chat_rag_duration_seconds counters
                # as the other error paths — the condense raise happens
                # before the orchestrate-span metrics block, so the failure
                # would otherwise be invisible to dashboards. Mirror the
                # _chat_attrs contract (response_type / abstained /
                # abstention_reason / error / retrieval_source) with a local
                # fallback for retrieval_source since retriever_parameters is not built
                # yet at this point in the request.
                _condense_start = time.time()
                try:
                    retrieval_query = await self._condense_query(condense_history, last_translated_message_content)
                    # The RAG prompt question stays the RAW last message; the
                    # rewritten query is retrieval/rerank-only (align_outputs).
                    genie_params["condense_raw_query"] = last_translated_message_content
                except HTTPException:
                    _condense_duration = time.time() - _condense_start
                    _condense_err_attrs = sanitize_attributes(
                        {
                            "response_type": "streaming" if chat_request.stream else "sync",
                            "abstained": "false",
                            "abstention_reason": "",
                            "error": "true",
                            "retrieval_source": getattr(chat_request, "search_type", None)
                            or "similarity_score_threshold",
                        }
                    )
                    chat_requests_total.add(1, _condense_err_attrs)
                    chat_rag_duration_seconds.record(_condense_duration, _condense_err_attrs)
                    raise
            else:
                # Zero LLM calls, but the skip is observable — mode active,
                # no history. Answers "why is there no rewrite?" from traces.
                _condense_tracer = get_tracer("chatqna.query_condense")
                with _condense_tracer.start_as_current_span("chatqna.query_condense") as _span:
                    _condense_span_attrs(_span, "skipped_no_history", 0)
        elif MULTI_TURN_BLEND_ENABLED and MULTI_TURN_HISTORY_TURNS > 0:
            _blend_enabled, _blend_alpha, _blend_turns = _resolved_blend_settings(translated_history_string)
        if _blend_enabled:
            history_text = _extract_history_text(translated_history_string, MULTI_TURN_HISTORY_TURNS)
            if history_text and logflag:
                logger.debug(
                    f"Multi-turn blend enabled: alpha={MULTI_TURN_BLEND_ALPHA}, "
                    f"history_turns={MULTI_TURN_HISTORY_TURNS}, "
                    f"history_chars={len(history_text)}"
                )

        # Extract the retrieval context if it is provided in the request.
        # Set to empty dict as a default if it is missing.
        retrieval_context = {}
        if chat_request.context:
            try:
                # If Pydantic is v2+
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                # Backup - can be removed later
                logger.warning(".model_dump method not supported")
                retrieval_context = chat_request.context.dict(exclude_unset=True)
        if logflag:
            if isinstance(retrieval_context, dict):
                ctx_desc = list(retrieval_context.keys())
            else:
                ctx_desc = type(retrieval_context).__name__
            logger.debug(f"Retrieval Context: {ctx_desc}")

        llm_kwargs = dict(
            top_k=chat_request.top_k if chat_request.top_k else 10,
            top_p=chat_request.top_p if chat_request.top_p else 0.95,
            temperature=chat_request.temperature if chat_request.temperature else 0.01,
            frequency_penalty=chat_request.frequency_penalty if chat_request.frequency_penalty else 0.0,
            presence_penalty=chat_request.presence_penalty if chat_request.presence_penalty else 0.0,
            stream=chat_request.stream if chat_request.stream else False,
        )
        # Only set max_tokens when explicitly provided — let the LLM use its own default.
        # Pydantic >=2.13 rejects None for int fields (regression from rebuild with newer deps).
        if chat_request.max_tokens is not None:
            llm_kwargs["max_tokens"] = chat_request.max_tokens
        if chat_request.chat_template:
            llm_kwargs["chat_template"] = chat_request.chat_template
        if chat_request.model:
            llm_kwargs["model"] = chat_request.model
        parameters = LLMParams(**llm_kwargs)
        retriever_parameters = GenieaiRetrieverParms(
            # in the current implementation, search_type should always be set to similarity_score_threshold,
            # otherwise not possible to calculate confidence scores
            # this is currently enforced by the genieai_api_protocol (ChatCompletionRequest model)
            search_type=chat_request.search_type if chat_request.search_type else "similarity_score_threshold",
            k=chat_request.k if chat_request.k is not None else RETRIEVER_K,
            fetch_k=chat_request.fetch_k if chat_request.fetch_k is not None else RETRIEVER_FETCH_K,
            search_start=chat_request.search_start if chat_request.search_start is not None else RETRIEVER_SEARCH_START,
            enable_traversal=chat_request.enable_traversal
            if chat_request.enable_traversal is not None
            else RETRIEVER_TRAVERSAL_ENABLED,
            traversal_max_depth=chat_request.traversal_max_depth
            if chat_request.traversal_max_depth is not None
            else RETRIEVER_TRAVERSAL_MAX_DEPTH,
            traversal_max_returned=chat_request.traversal_max_returned
            if chat_request.traversal_max_returned is not None
            else RETRIEVER_TRAVERSAL_MAX_RETURNED,
            traversal_score_threshold=chat_request.traversal_score_threshold
            if chat_request.traversal_score_threshold is not None
            else RETRIEVER_TRAVERSAL_SCORE_THRESHOLD,
            distance_threshold=chat_request.distance_threshold
            if chat_request.distance_threshold is not None
            else RETRIEVER_DISTANCE_THRESHOLD,
            lambda_mult=chat_request.lambda_mult if chat_request.lambda_mult is not None else RETRIEVER_LAMBDA_MULT,
            score_threshold=chat_request.score_threshold
            if chat_request.score_threshold is not None
            else RETRIEVER_SCORE_THRESHOLD,
        )

        reranker_parameters = GenieaiRerankerParms(
            reranking_strategy=chat_request.reranking_strategy
            if chat_request.reranking_strategy is not None
            else RERANKING_STRATEGY,
            top_n=chat_request.top_n if chat_request.top_n is not None else RERANKER_TOP_N,
            reranking_threshold=chat_request.reranking_threshold
            if chat_request.reranking_threshold is not None
            else RERANKING_THRESHOLD,
        )

        # RAG orchestration with tracing span
        tracer = get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            # Captured here because the streaming body is consumed after this
            # block closes, when the active context is the request task's rather
            # than this trace's. The outcome span it parents needs this handle.
            _orchestrate_context = otel_trace.set_span_in_context(span)
            # Stamped here so the id is on the span that owns the turn, not only
            # on the leaf spans below it: a request that dies before the LLM
            # node still leaves a trace an operator can join to the stored query.
            # Omitted when the caller sent no baggage, never a placeholder.
            _query_id = query_id_from_baggage()
            if _query_id:
                span.set_attribute(QUERY_ID_KEY, _query_id)
            span.set_attribute("rag.query_length", len(last_translated_message_content))
            # Telemetry only — the loud model-id gate lives in the payload
            # sites (generation, condense, tokenize); the attribute records
            # what discovery knows, never aborts the request.
            span.set_attribute("rag.model_id", discover_model_id(_LLM_DISCOVERY_ENDPOINT) or "undiscovered")
            # What this request actually blended, and the answer reserve it is
            # budgeted against. The token estimate and the history counts are
            # written by align_inputs, which is the only site that measures
            # them. window_tokens is written here as well as there: the two
            # agree (same TTL-cached discovery), and the copy here survives a
            # request that dies before the LLM node runs.
            _set_attributes(span, _blend_attributes(_blend_enabled, _blend_alpha, _blend_turns))
            # What the embedder was fed for this query (translated English or
            # an untranslated fallback): the retrieval-quality question "was
            # this Spanish query embedded as Spanish?" is answerable from the
            # trace alone.
            span.set_attribute(ATTRIBUTE_NAMES["rag_translation_query_status"], query_translation_status)
            _set_attributes(
                span,
                _prompt_budget_attributes(
                    window_tokens=_get_max_model_len(),
                    # Same reserve align_inputs reads, via the same helper. The
                    # two sources agree because comps turns LLMParams into a
                    # dict that preserves the dataclass default: align_inputs
                    # indexes that dict's "max_tokens" unguarded, so an absent
                    # key would already KeyError there. align_inputs also
                    # rewrites this attribute last, so a divergence can only
                    # survive on a request that dies before the LLM node.
                    answer_budget_tokens=_resolve_answer_budget_tokens(getattr(parameters, "max_tokens", None)),
                    estimate=None,
                ),
            )

            _rag_start = time.time()

            def _chat_attrs(abstained: str, error: str, abstention_reason: str = "") -> dict:
                """Metric attribute set shared by the success / abstention / error paths.

                ``abstention_reason`` is the machine code when the turn
                abstained, "" otherwise — a bounded vocabulary, so the counter
                can split a spike into stale scopes vs an over-rejecting
                reranker.
                """
                return sanitize_attributes(
                    {
                        "response_type": "streaming" if chat_request.stream else "sync",
                        "abstained": abstained,
                        "error": error,
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                        "abstention_reason": abstention_reason,
                    }
                )

            try:
                try:
                    # Fill in the keys that depend on the parameters built
                    # above; ``condense_raw_query`` was already set (or
                    # omitted) by the condense-rewrite branch.
                    genie_params["retriever_parameters"] = retriever_parameters
                    genie_params["reranker_parameters"] = reranker_parameters
                    genie_params["retrieval_context"] = retrieval_context
                    # The labels the retrieval filtered on, by the pipeline's
                    # own rule (core.label_contract): the admin Inspector reads
                    # them from the metadata instead of re-deriving the rule
                    # in JavaScript.
                    filter_labels = build_filter_labels(retrieval_context)
                    result_dict, runtime_graph = await self.megaservice.schedule(
                        initial_inputs={
                            "text": retrieval_query,
                            # Carried through to the embedding node so it can batch
                            # [query, history] in ONE TEI call. Empty when blending
                            # is disabled (flag off / first turn). Non-EmbedDoc field
                            # is stripped before the retriever HTTP call by OPEA.
                            "_blend_history_text": history_text,
                            "_blend_alpha": MULTI_TURN_BLEND_ALPHA,
                        },
                        llm_parameters=parameters,
                        genie_params=genie_params,
                    )
                except _RerankerInputTooLongError:
                    # Already typed by align_outputs — skip the chain walk.
                    raise
                except Exception as _e:
                    # Walk the exception chain looking for the reranker input-too-long
                    # marker. OPEA's ServiceOrchestrator wraps the underlying
                    # HTTPException(422) with its own exception type; the marker is
                    # preserved in the message chain (HTTPException.detail is
                    # JSON-stringified into the wrapper message). TEI's error string
                    # says "must have less than N tokens" — only the protocol marker
                    # is a reliable match.
                    _chain: list = []
                    _cur = _e
                    while _cur is not None and len(_chain) < 10:
                        _chain.append(str(_cur))
                        _cur = _cur.__cause__ or _cur.__context__
                    _joined = " | ".join(_chain)
                    if _RERANKER_INPUT_TOO_LONG_TYPE in _joined:
                        raise _RerankerInputTooLongError(_joined) from _e
                    raise
                _rag_duration = time.time() - _rag_start

                # Count the chunks fed to the LLM. (Was always 0: node outputs
                # are dicts but the old code used hasattr(dict, "retrieved_docs"),
                # which is always False — docs are a key, not an attribute.)
                span.set_attribute("rag.chunk_count", _count_final_chunks(result_dict))

                # Record custom application metrics. The `abstained` attribute
                # follows the same signal as the metadata event: the turn had
                # no document backing.
                _abstained, _abstention_reason = _abstention_outcome(result_dict)
                _metric_attrs = _chat_attrs("true" if _abstained else "false", "false", _abstention_reason or "")
                chat_requests_total.add(1, _metric_attrs)
                chat_rag_duration_seconds.record(_rag_duration, _metric_attrs)

            except _RerankerInputTooLongError as e:
                from opentelemetry.trace import StatusCode

                # Graceful abstention. The caller (frontend / mobile) sent a
                # valid request; the internal pipeline self-protected because
                # dataprep produced input too long for the reranker's strict
                # input cap. HTTP 200 + abstained=True mirrors the existing
                # "no confident answer" behaviour — operators get the same UX
                # as a low-confidence reranker outcome, but with a distinct
                # abstention_reason so dashboards can attribute it.
                span.set_status(
                    StatusCode.ERROR,
                    "Reranker input too long — abstaining",
                )
                span.set_attribute("abstained.reason", "reranker_input_too_long")
                logger.warning(f"Abstaining: reranker input too long. {e}")

                chat_requests_total.add(1, _chat_attrs("true", "false", "reranker_input_too_long"))

                # The reranker never returned a selection (schedule raised
                # before result_dict was bound), so emit an empty selection
                # span — the eval harness keys on rag.selected_chunk_keys and
                # must see the abstention as "nothing selected", not a missing
                # span.
                _emit_reranker_selection_span(candidate_chunk_keys=[], selected_chunk_keys=[], selected_scores=[])

                # The English abstention text. Who translates it depends on the
                # path: a streamed answer is translated by the backend (it owns
                # the streaming translation), a non-streamed one by this
                # service. One owner per path — translating on both would
                # translate the abstention twice, once into the target
                # language and once again from English.
                abstention_text = (
                    "I cannot reliably answer this query because the "
                    "retrieved documents exceed the reranker's input "
                    "limit. This indicates a data ingestion issue."
                )
                metadata = {
                    "source_documents": [],
                    # Bound before schedule() raised, so the scope the reranker
                    # was fed is still known on this path.
                    "filter_labels": list(filter_labels),
                    "retrieval_confidence_score": 0.0,
                    "confidence_score": 0.0,
                    "is_grounded": False,
                    # Same contract as the normal paths: what the embedder was
                    # fed for this query.
                    "query_translation_status": query_translation_status,
                }
                _mark_abstention(metadata, "reranker_input_too_long")
                if chat_request.stream:
                    # The backend translates the stream. The English text goes
                    # out as it is, and the backend reports its own translation
                    # failure on the done frame.
                    final_text = abstention_text
                else:
                    # Route the English abstention text through the same
                    # strip-before-translate finalizer as normal LLM answers so
                    # non-English users get the abstention in their language.
                    #
                    # Translation overflow on the abstention path: fall back to
                    # the English source text and flag the failure in metadata so
                    # the contract (HTTP 200 + abstained=True + abstention_reason=
                    # reranker_input_too_long) holds for non-EN users whose
                    # translation service rejects the abstention text.
                    translation_status = None
                    try:
                        final_text, _, translation_status = await self._finalize_llm_response(
                            abstention_text, original_language
                        )
                    except TranslationInputTooLongError as e:
                        logger.warning(f"Translation overflow on abstention path: {type(e).__name__}: {str(e)[:200]}")
                        final_text = abstention_text
                        translation_status = "failed"
                    if language_refused:
                        # The request asked for a language the map does not
                        # know: the answer stays in English, and the caller has
                        # to be able to tell an answer it did not translate from
                        # a translated one.
                        translation_status = "refused"
                    # The key is there only when a translation was asked for:
                    # absent means the answer was never meant to leave the
                    # language it was written in.
                    if translation_status is not None:
                        metadata["translation_status"] = translation_status

                if chat_request.stream:
                    # Streaming callers get the same SSE envelope as a normal
                    # answer: one content event, the metadata event, then [DONE].
                    async def _abstention_stream():
                        yield f"data: {final_text.encode('utf-8')!r}\n\n"
                        yield "data: " + json.dumps({"type": "metadata", **metadata}) + "\n\n"
                        yield "data: [DONE]\n\n"

                    # The outcome span is recorded here as well as from
                    # _stream_with_metadata, so an abstained turn produces a span
                    # like any other. Absence of chatqna.stream_outcome on a
                    # streamed turn therefore means the turn was not streamed --
                    # not that the outcome went unrecorded.
                    #
                    # Parented on _orchestrate_context for the same reason the
                    # answer path is: this branch returns from inside the
                    # orchestrate block, and an unparented span would still be
                    # lost beside the retrieval and reranking spans.
                    #
                    # Values come from the metadata dict the SSE body is about
                    # to serialise, so the trace and the payload cannot disagree.
                    _emit_stream_outcome_span(
                        parent_context=_orchestrate_context,
                        retrieval_confidence=metadata["retrieval_confidence_score"],
                        self_confidence=None,
                        is_grounded=metadata["is_grounded"],
                        sentinel_present=False,
                        abstained=metadata["abstained"],
                        abstention_reason=metadata["abstention_reason"],
                    )

                    return StreamingResponse(_abstention_stream(), media_type="text/event-stream")

                return {"response": final_text, "metadata": metadata}

            except Exception as e:
                from opentelemetry.trace import StatusCode

                # Record error metric (shared by every failure family)
                _err_duration = time.time() - _rag_start
                _err_attrs = _chat_attrs("false", "true")
                chat_requests_total.add(1, _err_attrs)
                chat_rag_duration_seconds.record(_err_duration, _err_attrs)
                span.set_status(StatusCode.ERROR)
                span.record_exception(e)
                # Same fail-closed contract as the condense path: a request
                # that cannot reach, name or count against its LLM is
                # "LLM unavailable" (503), not a bug (500).
                if isinstance(e, (ModelDiscoveryError, TokenCountError, httpx.HTTPError)):
                    raise HTTPException(status_code=503, detail="llm_unavailable") from e
                raise

        if logflag:
            logger.debug(
                f"Result Dict: "
                f"{list(result_dict.keys()) if isinstance(result_dict, dict) else type(result_dict).__name__}"
            )
            logger.debug(f"\nRuntime Graph: {runtime_graph}")

        for _node, response in result_dict.items():
            if isinstance(response, StreamingResponse):
                # Wrap the token stream so the reranker-grounded metadata (source docs,
                # confidence, is_grounded) is emitted before [DONE]. Without this the
                # backend would re-run retrieval without the category filter / reranker.
                return StreamingResponse(
                    self._stream_with_metadata(
                        response.body_iterator,
                        result_dict,
                        token=token_str,
                        parent_context=_orchestrate_context,
                        filter_labels=filter_labels,
                        abstained=_abstained,
                        abstention_reason=_abstention_reason,
                        include_contexts=bool(getattr(chat_request, "include_contexts", False)),
                        query_translation_status=query_translation_status,
                    ),
                    media_type="text/event-stream",
                )

        llm_response = result_dict.get(self._find_node_key("llm", result_dict), {}).get(
            "text", "Sorry, I could not generate a response."
        )

        # Strip leaked conversation markers + the self-grade sentinel, then translate.
        # Extracted into _finalize_llm_response so the strip-before-translate ordering
        # (the #1 sentinel/translation collision risk) is unit-testable without the
        # full handle_request megaservice flow.
        try:
            final_text_response, self_confidence, translation_status = await self._finalize_llm_response(
                llm_response, original_language
            )
        except TranslationInputTooLongError as _e_trans_overflow:
            # The translation service rejected a chunk for exceeding the model's
            # configured context window (4-12× oversized when DATAPREP_CONTEXTUAL_DOC_BUDGET
            # is left at its 100k-char default). Fail-loud: surface as HTTP 422 so the BFF
            # can render a localized error rather than the FastAPI default 500 with
            # internal exception text. Issue #829 contract.
            logger.warning(
                f"Translation overflow at handle_request boundary: "
                f"{type(_e_trans_overflow).__name__}: {str(_e_trans_overflow)[:200]}"
            )
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "translation_input_too_long",
                    "message": (
                        "The translated reply exceeded the language model's input "
                        "context window. Please reduce the conversation length or "
                        "retry with fewer references."
                    ),
                    "abstained": True,
                    "abstention_reason": "translation_input_too_long",
                },
            ) from _e_trans_overflow

        # Assemble source documents + confidence + grounding flag. Reflects the reranker's
        # verdict; not grounded (is_grounded=False) when the reranker found nothing relevant.
        source_documents_formatted, retrieval_confidence, is_grounded = await self._assemble_source_documents(
            result_dict, token=token_str, include_contexts=bool(getattr(chat_request, "include_contexts", False))
        )
        _conf_score = round(
            _display_confidence(retrieval_confidence, self_confidence)
            if LLM_SELF_CONFIDENCE_ENABLED
            else retrieval_confidence,
            2,
        )
        logger.debug(
            "Non-streaming confidence emission: "
            f"retrieval_conf={retrieval_confidence} self_conf={self_confidence} "
            f"is_grounded={is_grounded} SELF_CONF_FLAG={LLM_SELF_CONFIDENCE_ENABLED} "
            f"-> confidence_score={_conf_score}"
        )

        # Construct the final JSON payload
        metadata = {
            "source_documents": source_documents_formatted,
            # The labels the retrieval filtered on (empty when the query was
            # unfiltered), so an operator sees the scope behind an abstention.
            "filter_labels": list(filter_labels),
            # Raw retrieval confidence (rank-weighted) — always present for admin/eval.
            "retrieval_confidence_score": round(retrieval_confidence, 2),
            # Citizen-facing: the LLM self-grade when the feature is on (fallback to
            # retrieval so the badge never disappears), else the retrieval confidence.
            # Surfacing the self-grade is transparent to clients (they already render
            # confidence_score); only LLM_SELF_CONFIDENCE_ENABLED needs enabling.
            "confidence_score": round(
                _display_confidence(retrieval_confidence, self_confidence)
                if LLM_SELF_CONFIDENCE_ENABLED
                else retrieval_confidence,
                2,
            ),
            # Whether the answer is backed by retrieved document chunks (true) or
            # generated from the LLM's parametric knowledge (false). Frontend uses
            # this to flag responses that have no document basis.
            "is_grounded": is_grounded,
            # What the history translator fed the embedder: "translated",
            # "passthrough_english", "passthrough_unknown_language",
            # "fallback_timeout" or "fallback_error". Distinct from
            # translation_status above, which describes the ANSWER's
            # translation; this one describes the QUERY's.
            "query_translation_status": query_translation_status,
        }
        # `_abstained` was computed in the schedule block above (it also drove
        # the metric), so the metric and this metadata cannot come from
        # different runs.
        if _abstained:
            _mark_abstention(metadata, _abstention_reason)
        if LLM_SELF_CONFIDENCE_ENABLED:
            # Raw LLM self-assessed groundedness; None when the sentinel was omitted
            # or malformed.
            metadata["self_confidence"] = round(self_confidence, 2) if self_confidence is not None else None
        if language_refused:
            # The request asked for a language the map does not know: the
            # answer stays in English, and the caller has to be able to tell an
            # answer it did not translate from a translated one.
            translation_status = "refused"
        if translation_status is not None:
            # What happened to the answer the caller reads: "ok" when it was
            # translated, "refused" when the requested language was refused,
            # "failed" when the translation broke. Both of the last two leave
            # the English answer in place, so the caller has to be able to
            # tell an untranslated answer from a translated one.
            metadata["translation_status"] = translation_status

        final_response_payload = {
            "response": final_text_response,
            "metadata": metadata,
        }

        # Return as a JSONResponse
        if logflag:
            logger.info(f"Megaservice output payload: {final_response_payload}")
        return final_response_payload

    def start(self):

        self.service = MicroService(
            self.__class__.__name__,
            service_role=ServiceRoleType.MEGASERVICE,
            host=self.host,
            port=self.port,
            endpoint=self.endpoint,
            input_datatype=ChatCompletionRequest,
        )

        self.service.add_route(self.endpoint, self.handle_request, methods=["POST"])

        # FastAPI auto-instrumentation is handled globally by tracing.py
        # setup_tracing() → FastAPIInstrumentor().instrument() runs before
        # OPEA comps creates the FastAPI app, so traceparent extraction works.

        self.service.start()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--without-rerank", action="store_true")
    parser.add_argument("--faqgen", action="store_true")
    # Added --with-translation to prevent crash on unknown argument if CHATQNA_DAVID is used
    parser.add_argument("--with-translation", action="store_true")
    parser.add_argument("--without-translation", action="store_true")
    parser.add_argument("--genieai", action="store_true")
    args = parser.parse_args()

    chatqna = ChatQnAService(port=MEGA_SERVICE_PORT)
    if args.without_rerank:
        chatqna.add_remote_service_without_rerank()
    elif args.faqgen:
        chatqna.add_remote_service_faqgen()
    elif args.without_translation:
        chatqna.add_remote_service_without_translation()
    elif args.genieai:
        chatqna.add_remote_service_genieai()
    else:
        chatqna.add_remote_service()

    chatqna.start()
