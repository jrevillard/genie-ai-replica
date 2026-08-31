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

from metrics import (
    chat_rag_duration_seconds,
    chat_requests_total,
    sanitize_attributes,
)

from core.model_cache import get_model_id
from tracing import get_tracer, setup_trace_logging, setup_tracing

setup_tracing("genieai-chatqna")

import aiohttp  # for async http requests
import httpx
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

HTTPXClientInstrumentor().instrument()

from comps import CustomLogger, MegaServiceEndpoint, MicroService, ServiceOrchestrator, ServiceRoleType, ServiceType
from comps.cores.proto.docarray import LLMParams, RerankerParms, RetrieverParms
from comps.cores.proto.genieai_api_protocol import (
    ChatCompletionRequest,
)
from fastapi import Request
from fastapi.responses import StreamingResponse
from langdetect import detect
from transformers import AutoTokenizer

logger = CustomLogger("GENIE.AI_CHATQNA")
setup_trace_logging("GENIE.AI_CHATQNA")

# Tracer for pipeline-node-level spans emitted from align_outputs (e.g. the
# reranker-selection identity span used by the retrieval-quality eval harness).
# The orchestrate handler keeps its own scope-local tracer; this one serves the
# service-merge path where both candidate and selected chunk ids are known.
align_tracer = get_tracer("chatqna.align_outputs")


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


MEGA_SERVICE_PORT = int(os.getenv("MEGA_SERVICE_PORT", 8888))
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
if _VLLM_TRANSLATION_ENDPOINT:
    TRANSLATION_LLM_URL = f"{_VLLM_TRANSLATION_ENDPOINT}/v1/chat/completions"
    TRANSLATION_COMPLETIONS_URL = f"{_VLLM_TRANSLATION_ENDPOINT}/v1/completions"
else:
    TRANSLATION_LLM_URL = f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/chat/completions"
    TRANSLATION_COMPLETIONS_URL = f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/completions"
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
    from urllib.parse import urlparse

    _parsed = urlparse(_VLLM_LLM_ENDPOINT)
    LLM_SERVER_HOST_IP = _parsed.hostname or LLM_SERVER_HOST_IP
    LLM_SERVER_PORT = _parsed.port or 443
    LLM_SERVER_PROTOCOL = _parsed.scheme or "https"
    LLM_SERVER_ENDPOINT_PREFIX = _parsed.path.rstrip("/") or ""
else:
    LLM_SERVER_ENDPOINT_PREFIX = ""
LLM_MODEL = os.getenv("LLM_MODEL", "ibm-granite/granite-3.3-2b-instruct")

# Auto-detect remote vLLM models with TTL caching (see core/model_cache.py).
# GPU_NODE_HOST gates this: local GPU deployments keep their explicit config
# (VLLM_ENDPOINT has a compose default http://vllm:8000). See issue #758.
_GPU_NODE_HOST = os.getenv("GPU_NODE_HOST", "")


def _get_llm_model() -> str:
    """Return the LLM model ID.

    Auto-detects from remote vLLM (with TTL cache) when GPU_NODE_HOST is set;
    otherwise returns the LLM_MODEL env/config default.
    """
    if _GPU_NODE_HOST and _VLLM_LLM_ENDPOINT:
        detected = get_model_id(_VLLM_LLM_ENDPOINT)
        if detected:
            return detected
    return LLM_MODEL


def _get_translation_model_id() -> str:
    """Return the translation model ID.

    Auto-detects from remote vLLM (with TTL cache) when GPU_NODE_HOST is set;
    otherwise returns the TRANSLATION_MODEL_ID env/config default.
    """
    if _GPU_NODE_HOST and _VLLM_TRANSLATION_ENDPOINT:
        detected = get_model_id(_VLLM_TRANSLATION_ENDPOINT)
        if detected:
            return detected
    return TRANSLATION_MODEL_ID


def _is_translategemma() -> bool:
    """True when the active translation model is TranslateGemma.

    TranslateGemma uses the completions API with a pre-formatted prompt;
    other models use the chat completions API.
    """
    return "translategemma" in _get_translation_model_id().lower()


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
LANGUAGE_CODES_FILEPATH = os.getenv("LANGUAGE_CODES_FILEPATH", "language_codes.json")
MAX_MODEL_LEN_TEXTGEN = int(os.getenv("MAX_MODEL_LEN_TEXTGEN", 4096))  # max token length for text generation models

MAX_TRANSLATION_CHARS = int(os.getenv("MAX_TRANSLATION_CHARS", 2000))  # max characters for translation models
USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)


def _extract_history_text(translated_history_string, n_turns):
    """Return the previous N turns from the pipe-delimited history blob.

    The blob format is "ROLE: content |<-MSG->| ROLE: content |<-MSG->| ...",
    the same string handle_request builds (English-normalized for non-EN
    conversations so it matches the bge-base-en-v1.5 embedding space). The last
    segment is the current user turn (already extracted as the query via
    USER_MSG_PATTERN); everything before it is history. We return the last
    `n_turns` prior segments joined into one string for a single embedding call.

    Returns "" on empty input, first turn (no prior history), or n_turns<=0.
    """
    if not translated_history_string or n_turns <= 0:
        return ""
    segments = [s.strip() for s in translated_history_string.split("|<-MSG->|") if s.strip()]
    if len(segments) < 2:
        return ""
    prior = segments[:-1]
    return " ".join(prior[-n_turns:])


def _blend_embeddings(query_emb, history_emb, alpha):
    """V = α·EQ + (1-α)·EH, elementwise.

    Alpha is clamped to [0,1]. Returns query_emb unchanged when history_emb is
    empty or dimensions mismatch (defensive — never raises).
    """
    if not history_emb or len(query_emb) != len(history_emb):
        return query_emb
    a = max(0.0, min(1.0, float(alpha)))
    return [a * q + (1.0 - a) * h for q, h in zip(query_emb, history_emb, strict=False)]


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
CHATQNA_ABSTENTION_INSTRUCTIONS = os.getenv("CHATQNA_ABSTENTION_INSTRUCTIONS", "").strip() or None
SENSITIVE_KEYS = set(os.getenv("SENSITIVE_KEYS", "").split(","))


def _build_filter_labels(retrieval_context: dict) -> list[str]:
    """Build the retriever filter-label list from the retrieval context.

    Accepts both ``categoryLabel`` (singular — the contract the frontend/backend
    sends) and ``categoryLabels`` (plural — legacy), plus ``serviceLabels``.
    Singular values are coerced to a single-element list. Null/empty values add
    nothing (no category filter). Order: category, then service labels.

    Extracted from ``align_inputs`` for unit testability — the label-coercion
    logic is otherwise buried inside the 1000-line ``generate_flow`` method.

    Args:
        retrieval_context: The ``context`` dict from the chat request.

    Returns:
        A flat list of filter labels (may be empty = no filter).
    """
    if not retrieval_context:
        return []
    labels: list[str] = []
    cat_label = retrieval_context.get("categoryLabel")
    if cat_label:
        # Coerce scalars to a single-element list; iterables extended as-is.
        if isinstance(cat_label, str):
            labels.append(cat_label)
        elif isinstance(cat_label, list):
            labels.extend(cat_label)
        else:
            labels.append(str(cat_label))
    cat_labels = retrieval_context.get("categoryLabels")
    if cat_labels:
        if isinstance(cat_labels, list):
            labels.extend(cat_labels)
        else:
            labels.append(str(cat_labels))
    if retrieval_context.get("serviceLabels"):
        svc = retrieval_context["serviceLabels"]
        if isinstance(svc, list):
            labels.extend(svc)
        else:
            labels.append(str(svc))
    # Coerce + dedup while preserving order. Non-string non-list entries are
    # stringified (defensive against malformed clients); falsy values dropped.
    seen: set[str] = set()
    deduped: list[str] = []
    for label in labels:
        if not label:
            continue
        normalized = label if isinstance(label, str) else str(label)
        if normalized not in seen:
            seen.add(normalized)
            deduped.append(normalized)
    return deduped


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
        self._token = None
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")

    def set_token(self, token: str):
        self._token = token

    async def get_user_profile(self):
        """
        Fetches the sanitized user profile from the backend for context enrichment.
        Target: GET /api/me/context
        Auth: Bearer token (propagated from backend via Authorization header)
        """
        if not self._token:
            logger.warning("No Bearer token available, skipping profile fetch")
            return None

        # Construct URL
        url = f"{BACKEND_SERVICE_URL}/api/me/context"

        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            _timeout = aiohttp.ClientTimeout(total=30)
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
# TOKENIZER
##################################################################################################################################
TOKENIZER = None


def get_tokenizer():
    global TOKENIZER
    if TOKENIZER is None:
        TOKENIZER = AutoTokenizer.from_pretrained(
            _get_llm_model(),
            use_fast=True,
            # local_files_only=True
        )
    return TOKENIZER


##################################################################################################################################
# CHATQNA ORCHESTRATOR FUNCTIONS
##################################################################################################################################
def align_inputs(self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs):

    if self.services[cur_node].service_type == ServiceType.TRANSLATOR:
        original_text = inputs["text"]
        original_language = kwargs.get("original_language", "auto")

        if original_language and original_language.strip().upper() == "EN":
            target_language = "English"
        else:
            target_language = original_language

        prompt = (
            f"Translate the following text to {target_language}. Only provide "
            f"the translation, with no additional commentary or explanations. "
            f'Text: "{original_text}"'
        )

        # Format the request for the LLM service
        next_inputs = {}
        next_inputs["messages"] = [{"role": "user", "content": prompt}]
        next_inputs["temperature"] = 0  # Use low temperature for deterministic translation
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["stream"] = False

        if logflag:
            logger.debug(f"Aligned input to the translator: {next_inputs}")

        return next_inputs

    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
        # Multi-turn vector-space blending (issue #833, E2 design): when a
        # history text is present, embed [query, history] as a SINGLE batched
        # TEI call instead of a side-channel httpx request. align_outputs
        # EMBEDDING then blends the two returned vectors. Empty/absent history
        # = single-input path (unchanged baseline behavior).
        _blend_history_text = inputs.pop("_blend_history_text", "")
        _blend_alpha = inputs.pop("_blend_alpha", None)
        if _blend_history_text:
            inputs["input"] = [inputs["text"], _blend_history_text]
            # Stash alpha for align_outputs to use when blending the batch
            # response. `_blend_alpha` does leak into the embedding service HTTP
            # body (harmless — TEI ignores unknown JSON keys) but never reaches
            # the retriever: align_outputs(EMBEDDING) builds a fresh next_data
            # containing only {"text", "embedding"}, so the key is dropped at
            # that boundary, not by any underscore-prefix convention.
            inputs["_blend_alpha"] = _blend_alpha
        else:
            inputs["input"] = inputs["text"]
        del inputs["text"]

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        retriever_parameters = kwargs.get("retriever_parameters")
        if retriever_parameters:
            # inputs.update(retriever_parameters.model_dump())
            safe_params = retriever_parameters.model_dump(exclude_unset=True, exclude_none=True)
            inputs.update(safe_params)

        # DATA CONTRACT: encode filter labels into search_start.
        #
        # The OPEA MicroService framework creates a dynamic __main__ input type
        # from the HTTP body when parsing requests at the retriever endpoint.
        # This dynamic type ONLY preserves standard EmbedDoc fields (text,
        # embedding, search_type, k, search_start, traversal_*, etc.). Custom
        # fields like "context" are silently dropped — verified via probes
        # (POST body has context, retriever's parsed input does not).
        #
        # To pass filter labels through this contract boundary, encode them in
        # search_start (a standard EmbedDoc string field that survives parsing).
        # Format: "{base_mode}::labels:{label1},{label2},..."
        # The retriever parses this to build labels_to_filter for its DB-level
        # label filter (BM25 aql_filter_clause + dense post-filter).
        retrieval_context = kwargs.get("retrieval_context", {})
        # Build filter labels (category singular/plural + service). Extracted to
        # _build_filter_labels for testability.
        _filter_labels = _build_filter_labels(retrieval_context)
        if _filter_labels:
            from core.label_contract import encode_filter_labels

            _base_mode = inputs.get("search_start", "chunk")
            inputs["search_start"] = encode_filter_labels(_base_mode, _filter_labels)

    elif self.services[cur_node].service_type == ServiceType.RERANK:
        reranker_parameters = kwargs.get("reranker_parameters")
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
        translated_history_string = kwargs.get("full_chat_history_string", "")

        user_details = kwargs.get("user_details", {})

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
        original_language = kwargs.get("original_language")
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

        prompt_add_context = (
            f"\n\nUSER INFORMATION:\n{user_context_string}"
            f"\n\nCHAT HISTORY:\n{translated_history_string}"
            f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \n{rag_augmented_prompt}"
        )

        # FIX: Separate system and user content for proper chat template handling
        user_content = prompt_add_context

        tokenizer = get_tokenizer()
        max_model_tokens = MAX_MODEL_LEN_TEXTGEN
        max_answer_tokens = llm_parameters_dict.get("max_tokens") or (MAX_MODEL_LEN_TEXTGEN - 200)
        # Count tokens in full prompt (system + user combined for token limit check)
        full_prompt_tokens = len(tokenizer.encode(system_instructions + user_content))
        # Check if the total token count exceeds the model's limit
        if full_prompt_tokens + max_answer_tokens > max_model_tokens - 200:  # Leave buffer
            # Calculate maximum tokens for history
            prompt_add_context_tokens = len(tokenizer.encode(prompt_add_context))
            translated_history_tokens = len(tokenizer.encode(translated_history_string))

            max_history_tokens = (
                max_model_tokens + translated_history_tokens - max_answer_tokens - prompt_add_context_tokens - 200
            )
            # Split the history into segments
            history_segments = translated_history_string.split(" |<-MSG->| ")
            truncated_history = []
            current_tokens = 0
            # Start from most recent messages
            for segment in reversed(history_segments):
                segment_tokens = len(tokenizer.encode(segment))
                if current_tokens + segment_tokens > max_history_tokens:
                    break
                truncated_history.insert(0, segment)  # Maintain order
                current_tokens += segment_tokens
            # Rebuild truncated history
            translated_history_string = " |<-MSG->| ".join(truncated_history)
            # Reconstruct user content (system instructions stay the same)
            user_content = (
                f"\n\nUSER INFORMATION:\n{user_context_string}"
                f"\n\nCHAT HISTORY:\n{translated_history_string}"
                f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}"
            )

        # FIX: Send system and user as separate messages for proper chat template handling
        next_inputs["messages"] = [
            {"role": "system", "content": system_instructions},
            {"role": "user", "content": user_content},
        ]
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["top_p"] = llm_parameters_dict["top_p"]
        next_inputs["stream"] = inputs["stream"]
        next_inputs["frequency_penalty"] = inputs["frequency_penalty"]
        next_inputs["temperature"] = inputs["temperature"]
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

    if self.services[cur_node].service_type == ServiceType.TRANSLATOR:
        if logflag:
            logger.debug(f"Raw output of the translator\n {data}\n")
        translated_text = data["choices"][0]["message"]["content"]

        # Clean up potential LLM conversational artifacts
        translated_text = translated_text.strip().strip('"')

        return {"text": translated_text}

    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
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
            input_val = inputs["input"]
            query_text = input_val[0] if isinstance(input_val, list) else input_val
            next_data = {"text": query_text, "embedding": blended}
        else:
            next_data = {"text": inputs["input"], "embedding": query_embedding}

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        if logflag:
            logger.debug(
                f"Raw output of the retriever: {type(data).__name__}, "
                f"keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}"
            )
        retrieved_docs = data.get("retrieved_docs", [])
        [doc["text"] for doc in retrieved_docs]

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
                assert len(file_id_list) == related_info_count, (
                    f"Length of file_id_list {len(file_id_list)} is not equal "
                    f"to related_info_count {related_info_count}"
                )
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    doc_text = retrieved_doc["text"]
                    if "\n------\nRELATED INFORMATION:\n------\n" in doc_text:
                        file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ""
                    else:
                        file_id_pairs[doc_id] = ""
            elif RETRIEVER_SEARCH_START == "chunk":
                assert len(file_id_list) == len(retrieved_docs), (
                    f"Length of file_id_list {len(file_id_list)} is not equal "
                    f"to length of retrieved_docs {len(retrieved_docs)}"
                )
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ""
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

            # FR17, FR19: Web search trigger & fusion (story 2-7: governed by
            # _apply_web_search_fallback — degradation truth table lives there)
            _scores = [(d.get("metadata") or {}).get("score") for d in retrieved_docs]
            max_score = max((s for s in _scores if isinstance(s, (int, float))), default=0.0)
            retrieved_docs, _degradation = self._apply_web_search_fallback(retrieved_docs, received_prompt, max_score)
            if _degradation:
                next_data["degradation"] = _degradation

            if not retrieved_docs and str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true":
                abstention_instructions = (
                    CHATQNA_ABSTENTION_INSTRUCTIONS
                    if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                    else (
                        "\n[Returned Documents] The knowledge base search did not "
                        "return any results. State clearly that you cannot answer "
                        "based on available information."
                    )
                )
                received_prompt += abstention_instructions
            else:
                received_prompt += "".join(f"\n[Retrieved Document]: {doc.get('text', '')}" for doc in retrieved_docs)

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
            reranker_parameters = kwargs.get("reranker_parameters")
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

        # FR17, FR19: Web search trigger & fusion (story 2-7: governed by
        # _apply_web_search_fallback — degradation truth table lives there)
        _scores = [d.get("score") for d in reranked_docs_with_scores]
        max_score = max((s for s in _scores if isinstance(s, (int, float))), default=0.0)
        reranked_docs_with_scores, _degradation = self._apply_web_search_fallback(
            reranked_docs_with_scores, initial_query, max_score
        )
        if _degradation:
            next_data["degradation"] = _degradation
        # Update docs list for prompt
        docs = [doc.get("text", "") for doc in reranked_docs_with_scores]

        if not docs and str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true":
            abstention_instructions = (
                CHATQNA_ABSTENTION_INSTRUCTIONS
                if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                else (
                    "\n[Retrieved Documents] The knowledge base search did not return any results. "
                    "State clearly that you cannot answer based on available information."
                )
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
        if "faqgen" in self.services[cur_node].endpoint:
            next_data = data
        else:
            if logflag:
                logger.debug(f"\nRaw output of the llm\n {data}\n")
            next_data["text"] = data["choices"][0]["message"]["content"]
        if logflag:
            logger.debug(f"\nAligned output of the llm\n {next_data}\n")
    else:
        next_data = data

    if logflag:
        logger.debug(
            f"FINAL ALIGNED DATA keys: {list(next_data.keys())}, text length: {len(next_data.get('text', ''))}"
        )

    return next_data


def align_generator(self, gen, **kwargs):
    # OpenAI response format
    # data:{"id":"","object":"text_completion","created":1725530204,
    # "model":"meta-llama/Meta-Llama-3-8B-Instruct","system_fingerprint":"2.0.1-native",
    # "choices":[{"index":0,"delta":{"role":"assistant","content":"?"},"logprobs":null,
    # "finish_reason":null}]}\n\n'
    for line in gen:
        line = line.decode("utf-8")
        chunks = [chunk.strip() for chunk in line.split("\n\n") if chunk.strip()]
        for line in chunks:
            start = line.find("{")
            end = line.rfind("}") + 1
            json_str = line[start:end]
            try:
                # sometimes yield empty chunk, do a fallback here
                json_data = json.loads(json_str)
                if "ops" in json_data and "op" in json_data["ops"][0]:
                    if "value" in json_data["ops"][0] and isinstance(json_data["ops"][0]["value"], str):
                        yield f"data: {repr(json_data['ops'][0]['value'].encode('utf-8'))}\n\n"
                    else:
                        pass
                elif "content" in json_data["choices"][0]["delta"]:
                    yield f"data: {repr(json_data['choices'][0]['delta']['content'].encode('utf-8'))}\n\n"
            except Exception:
                yield f"data: {repr(json_str.encode('utf-8'))}\n\n"
    yield "data: [DONE]\n\n"


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
        for key in result_dict:
            if key.startswith(service_name):
                return key
        return None

    async def fetch_file_metadata(self, file_id: str) -> dict:
        """
        Fetch metadata for a file by calling the relevant API.

        Args:
            file_id (str): The ID of the file to fetch metadata for.

        Returns:
            dict: A dictionary containing metadata, including labels.
        """
        if not file_id:
            return {"categoryLabels": None, "serviceLabels": []}

        token = self.user_profile_client._token
        if not token:
            logger.error("No Bearer token available for document-repository call.")
            return None

        file_get_metadata_url = f"{DOC_REPO_URL}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {token}"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            async with (
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session,
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
    ) -> tuple[str, float | None]:
        """Strip leaked conversation markers + the self-grade sentinel, then translate.

        Extracted from handle_request so the strip-before-translate ordering (the #1
        sentinel/translation collision risk) is unit-testable: the sentinel is removed
        from ``llm_response`` BEFORE it is handed to the translation pipeline. Returns
        ``(final_text_response, self_confidence_or_None)``.
        """
        # Strip leaked conversation markers from the LLM response. The LLM sometimes
        # echoes back the |<-MSG->| delimiters and USER:/ASSISTANT: role markers used
        # internally to format chat history in the prompt. Same shared patterns as the
        # streaming path (_stream_with_metadata) — see _CONV_SEP_RE / _CONV_ROLE_RE.
        llm_response = _CONV_SEP_RE.sub("\n", llm_response)
        llm_response = _CONV_ROLE_RE.sub("", llm_response)

        # Strip the self-grade sentinel before translation so it never reaches the
        # user or the translation pipeline; capture its value for metadata.
        self_confidence = None
        if LLM_SELF_CONFIDENCE_ENABLED:
            llm_response, self_confidence = _extract_self_confidence(llm_response)

        if original_language and original_language.strip() != "EN":
            if logflag:
                lang_type = type(original_language).__name__
                logger.info(f"Translation requested - original_language: '{original_language}' (type: {lang_type})")

            # Load Language Codes
            language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

            if logflag:
                keys_preview = list(language_codes.keys())[:10]
                logger.info(f"Language codes loaded - keys: {keys_preview}... (total: {len(language_codes)})")

            # Fallback logic for language codes. If not in map, use the original code.
            target_lang_name = original_language
            lookup_key = original_language.lower()

            if logflag:
                logger.info(f"Looking up language code: '{lookup_key}' in language_codes")

            if lookup_key in language_codes:
                target_lang_name = language_codes[lookup_key]
                if logflag:
                    logger.info(f"Found language code mapping: '{lookup_key}' -> '{target_lang_name}'")
            else:
                msg = (
                    f"Warning: Language '{original_language}' not found in "
                    f"language codes (lookup key: '{lookup_key}'). "
                    "Attempting to translate using code directly."
                )
                logger.warning(msg)

            if logflag:
                logger.debug(f"LLM response to be translated into: {target_lang_name}")

            try:
                final_text_response = await self._translate_with_chunking(
                    llm_response, target_lang_name, original_language
                )
                if logflag:
                    logger.info("Translation completed successfully")
            except Exception as e:
                logger.error(f"Translation failed: {e}, returning original response")
                final_text_response = llm_response
        else:
            final_text_response = llm_response

        if logflag:
            logger.debug(f"\nFinal Text Response: {final_text_response}")

        return final_text_response, self_confidence

    async def _assemble_source_documents(self, result_dict: dict) -> tuple[list, float, bool]:
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

        Returns:
            (source_documents, retrieval_confidence_score, is_grounded)
        """
        rerank_key = self._find_node_key("rerank", result_dict)
        retriever_key = self._find_node_key("retriever", result_dict)

        retriever_node_output = result_dict.get(retriever_key, {})
        file_id_pairs = retriever_node_output.get("file_id_pairs", {})
        # Retriever docs carry the orchestrator id + text + similarity score (metadata.score).
        retrieved_docs = retriever_node_output.get("retrieved_docs", [])

        # The reranker's verdict. NOTE: align_outputs (RERANK branch) stores the reranked
        # docs under the "retrieved_docs" key — with id + reranker score already
        # reconstructed — NOT under "reranked_docs" (that key is empty in the orchestrator
        # output). Each verdict doc is {id, text, score} where score is the reranker score.
        reranker_node_output = result_dict.get(rerank_key, {}) if rerank_key else {}
        rerank_verdict = reranker_node_output.get("retrieved_docs", []) if rerank_key else []

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

        source_documents_formatted = []
        scores = []
        source_documents_file_ids = []

        if logflag:
            logger.debug(f"display docs count: {len(display_docs)}, scores: {[d.get('score') for d in display_docs]}")

        for item in display_docs:
            if item.get("is_tool_result"):
                score = _calibrate_reranker_score(item.get("score", 0.0))
                source_documents_formatted.append(
                    {
                        "document_id": item.get("id"),
                        "document_name": item.get("tool_title", "Tool Result"),
                        "url": item.get("tool_url", ""),
                        "categoryLabels": [],
                        "serviceLabels": [],
                        "score": score,
                    }
                )
                scores.append(score)
                continue

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
                file_metadata = await self.fetch_file_metadata(file_id)
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
                    logger.warning(
                        f"Skipping document {doc_id_by_orchestrator}: metadata fetch "
                        f"failed for file ID {file_id}; not surfacing as a source."
                    )
                    continue

            # Mark this file as surfaced only after a successful metadata resolution,
            # so a duplicate of a file whose metadata failed does not contribute its
            # score to the aggregate while the file remains invisible (M3).
            source_documents_file_ids.append(file_id)
            source_documents_formatted.append(
                {
                    "document_id": file_id,
                    "document_name": file_name,
                    "url": file_read_url,
                    "categoryLabels": labels if isinstance(labels, list) else [labels] if labels else [],
                    "serviceLabels": [],
                    "score": score,
                }
            )
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

    def _apply_web_search_fallback(self, docs, query, max_score):
        """Story 2-7: low-confidence web-search fallback with degradation truth table.

        Called at both fusion seams (retriever and rerank nodes). Returns
        ``(docs, degradation_or_None)``:

        - max_score >= threshold: trigger not fired, docs unchanged, no degradation.
        - Backend failure (WebSearchError) with KB docs: RAG-only, deliberately
          NO degradation object (epic 2.7: silent when the KB still answers).
        - Backend failure without KB docs: SEARCH_UNAVAILABLE degradation so the
          UI can render a notice; docs stay empty -> abstention fires downstream.
        - Results below the FR24 quality gate: LOW_QUALITY degradation with
          alternative-source guidance (worded for whether KB docs exist);
          junk is never fused.
        - Usable results: fused as before (existing behavior, regression-guarded).

        Never raises: an unexpected failure (missing module in a built image,
        backend bug) degrades to RAG-only instead of failing the chat request —
        the optional web-search enhancement must not take the answer down.
        """
        threshold = 0.70
        if max_score >= threshold:
            return docs, None

        logger.info("Triggering web search fallback due to low RAG confidence (%.2f < %.2f)", max_score, threshold)
        try:
            from workflows.tools.fusion import ResultFusionEngine, filter_usable_results
            from workflows.tools.web_search import SearxngBackend, WebSearchError

            try:
                web_results = SearxngBackend().search_sync(query, num_results=3)
            except WebSearchError as exc:
                logger.warning("Web search unavailable: %s", exc)
                if not docs:
                    return docs, {
                        "tool_id": "web_search",
                        "reason": "SEARCH_UNAVAILABLE",
                        "fallback_applied": "none",
                        "message": "Web search is temporarily unavailable and the knowledge base "
                        "has no information on this topic. Try rephrasing your question or "
                        "contact the relevant office directly for up-to-date information.",
                    }
                return docs, None

            usable = filter_usable_results(web_results)
            if not usable:
                if docs:
                    message = (
                        "Web results were found but did not meet quality standards, so they were "
                        "not used. The answer is based on available knowledge base documents only; "
                        "for the latest information please consult the official source directly."
                    )
                else:
                    message = (
                        "Web results were found but did not meet quality standards, and the "
                        "knowledge base has no information on this topic. Please try rephrasing "
                        "your question or consult the relevant official source directly."
                    )
                return docs, {
                    "tool_id": "web_search",
                    "reason": "LOW_QUALITY",
                    "fallback_applied": "none",
                    "message": message,
                }

            fused = ResultFusionEngine().fuse(docs, usable, tool_id="web_search")
            return fused, None
        except Exception as exc:  # never kill the chat request — degrade to RAG-only
            logger.error("Web search fallback failed unexpectedly: %s", exc, exc_info=True)
            if not docs:
                return docs, {
                    "tool_id": "web_search",
                    "reason": "SEARCH_UNAVAILABLE",
                    "fallback_applied": "none",
                    "message": "Web search is temporarily unavailable and the knowledge base "
                    "has no information on this topic. Try rephrasing your question or "
                    "contact the relevant office directly for up-to-date information.",
                }
            return docs, None

    def _extract_degradation(self, result_dict):
        """Recover the degradation dict set by a fusion seam from the
        node-keyed megaservice result dict (state keys persist downstream)."""
        if not isinstance(result_dict, dict):
            return None
        for value in result_dict.values():
            if isinstance(value, dict) and value.get("degradation"):
                return value["degradation"]
        return None

    async def _stream_with_metadata(self, body_iterator, result_dict):
        """Forward the LLM token stream, then append a `metadata` SSE event.

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
            buffer += content
            buffer = _CONV_SEP_RE.sub("\n", buffer)
            buffer = _CONV_ROLE_RE.sub("", buffer)
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
        source_documents, retrieval_confidence, is_grounded = await self._assemble_source_documents(result_dict)
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
        metadata = {
            "type": "metadata",
            "source_documents": source_documents,
            # Raw retrieval confidence (rank-weighted) — always present for admin/eval.
            "retrieval_confidence_score": round(retrieval_confidence, 2),
            # Citizen-facing: the LLM self-grade when the feature is on (fallback to
            # retrieval so the badge never disappears), else the retrieval confidence.
            # Clients render this field unchanged — surfacing the self-grade needs no
            # client change beyond enabling LLM_SELF_CONFIDENCE_ENABLED.
            "confidence_score": round(
                _display_confidence(retrieval_confidence, self_confidence)
                if LLM_SELF_CONFIDENCE_ENABLED
                else retrieval_confidence,
                2,
            ),
            "is_grounded": is_grounded,
        }
        if LLM_SELF_CONFIDENCE_ENABLED:
            # Raw LLM self-assessed groundedness; None when the sentinel was
            # omitted/malformed. Never hard-fails the chat.
            metadata["self_confidence"] = round(self_confidence, 2) if self_confidence is not None else None
        # Story 2-7: degradation notice (web search unavailable / below quality)
        _degradation = self._extract_degradation(result_dict)
        if _degradation:
            metadata["degradation"] = _degradation
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

    def add_remote_service(self):

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

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_without_rerank(self):

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

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, llm)

    def add_remote_service_faqgen(self):

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

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/faqgen",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_without_translation(self):
        """
        Builds the full RAG pipeline wrapped with input and output translation.
        Flow: translator_in -> embedding -> retriever -> rerank -> llm -> translator_out
        """

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

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )

        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_genieai(self):
        """
        Builds the full RAG pipeline wrapped with input and output translation.
        Flow: translator_in -> embedding -> retriever -> rerank -> llm -> translator_out
        """

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

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )

        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    @staticmethod
    def _build_translategemma_prompt(
        text: str,
        source_lang_code: str,
        target_lang_code: str,
        source_lang_name: str = "English",
        target_lang_name: str = "English",
    ) -> str:
        """Build a prompt for TranslateGemma using the completions API.

        Duplicated in document-translation/genieai_pdf_translator.py — keep in sync.
        """
        return (
            f"<bos><start_of_turn>user\n"
            f"You are a professional {source_lang_name} ({source_lang_code}) to "
            f"{target_lang_name} ({target_lang_code}) translator. Your goal is to "
            f"accurately convey the meaning and nuances of the original {source_lang_name} "
            f"text while adhering to {target_lang_name} grammar, vocabulary, and cultural "
            f"sensitivities.\n"
            f"CRITICAL: You MUST output ONLY in {target_lang_name} ({target_lang_code}). "
            f"Do NOT output in Nepali, Hindi, Bengali, or any other language. "
            f"Do NOT use Devanagari, Bengali, or any non-Latin script. "
            f"{target_lang_name} uses the LATIN alphabet only.\n"
            f"Produce only the {target_lang_name} translation, without any additional "
            f"explanations or commentary. Please translate the following {source_lang_name} "
            f"text into {target_lang_name}:\n\n\n{text}"
            f"<end_of_turn>\n<start_of_turn>model\n"
        )

    async def _get_translated_history_string(
        self, history: list, target_language: str, source_lang_code: str = "en"
    ) -> str:
        """
        A helper that:
        1. Truncates history to stay within a token limit.
        2. Flattens the history into a single string.
        3. Sends the string to the translation LLM.

        Automatically uses TranslateGemma structured format or generic prompt format
        based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            history: Chat history as list of dicts or plain string (single-message mode).
            target_language: Target language name (e.g. "English").
            source_lang_code: Source ISO language code (e.g. "st") for TranslateGemma.
        """

        # Single-message mode sends history as a plain string — translate it
        if isinstance(history, str):
            return await self._translate_text_chunk(
                history, target_language, source_lang_code=source_lang_code, iso_code="en"
            )

        max_translation_chars = MAX_TRANSLATION_CHARS
        current_chars = 0
        messages_to_process = []
        if logflag:
            logger.debug(f"Processing translation for history with {len(history)} messages.")

        for message in reversed(history):
            if logflag:
                logger.debug(f"Examining message: {message}")
            message_chars = len(message["content"])
            if current_chars + message_chars > max_translation_chars:
                break
            messages_to_process.append(message)
            current_chars += message_chars
        messages_to_process.reverse()

        flattened_history_parts = []
        for message in messages_to_process:
            role = message.get("role", "unknown").upper()
            content = message.get("content", "")
            flattened_history_parts.append(f"{role}: {content}")

        flattened_history_string = " |<-MSG->| ".join(flattened_history_parts)

        # Build payload based on model type
        if _is_translategemma():
            # Use completions API with pre-formatted prompt (vLLM v0.10.0 cannot
            # pass structured content through chat completions to TranslateGemma's template)
            prompt = self._build_translategemma_prompt(
                text=flattened_history_string,
                source_lang_code=source_lang_code,
                target_lang_code="en",
                source_lang_name=source_lang_code.upper(),
                target_lang_name="English",
            )
            payload = {
                "model": _get_translation_model_id(),
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": min(max(len(flattened_history_string) // 2, 512), 4096),
                "repetition_penalty": 1.2,
            }
            url = TRANSLATION_COMPLETIONS_URL
        else:
            prompt = (
                f"Translate the following chat history to {target_language}. "
                f"Preserve the role markers (e.g., 'USER:', 'ASSISTANT:')."
                f"\n\nHISTORY:\n{flattened_history_string}"
            )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            svc = "TranslateGemma" if _is_translategemma() else "generic"
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
                if _is_translategemma():
                    translated_blob = response_data["choices"][0]["text"]
                else:
                    translated_blob = response_data["choices"][0]["message"]["content"]
                if logflag:
                    logger.debug(f"Translated chat history: {translated_blob.strip()}")
                return translated_blob.strip()

        except httpx.TimeoutException as e:
            logger.error(
                f"History translation timeout after "
                f"{TRANSLATION_SERVICE_TIMEOUT} seconds. Returning history "
                f"in original language. Error: {e}"
            )
            return flattened_history_string
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return flattened_history_string

    def load_language_codes(self, filepath: str) -> dict:
        """Load language codes from a JSON file."""
        try:
            with open(filepath) as file:
                language_codes = json.load(file)
            return language_codes
        except Exception as e:
            logger.error(f"Error loading language codes from {filepath}: {e}")
            return {}

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

    async def _translate_text_chunk(
        self, text: str, target_lang: str, iso_code: str = None, source_lang_code: str = "en"
    ) -> str:
        """Translate a single chunk of text.

        Automatically uses TranslateGemma completions API (with pre-formatted prompt)
        or generic chat completions format based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            text: Text to translate.
            target_lang: Target language name (e.g. "Sesotho").
            iso_code: Target ISO language code (e.g. "st").
            source_lang_code: Source ISO language code (e.g. "en"). Defaults to "en".
        """
        if _is_translategemma():
            target_lang_code = iso_code.lower() if iso_code else target_lang.lower()
            prompt = self._build_translategemma_prompt(
                text=text,
                source_lang_code=source_lang_code,
                target_lang_code=target_lang_code,
                source_lang_name=source_lang_code.upper(),
                target_lang_name=target_lang,
            )
            payload = {
                "model": _get_translation_model_id(),
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": min(max(len(text) // 2, 512), 4096),
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
            if iso_code:
                prompt = (
                    f"Translate the following text to {target_lang} "
                    f"(ISO 639-1 code: {iso_code}). {note} "
                    f"Only output the translated text, nothing else."
                    f"\n\nText: {text}\n\nTranslation:"
                )
            else:
                prompt = (
                    f"Translate the following text to {target_lang}. "
                    f"{note} Only output the translated text."
                    f"\n\nText: {text}\n\nTranslation:"
                )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            logger.debug(f"Translation payload ({'TranslateGemma' if _is_translategemma() else 'generic'}): {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                response.raise_for_status()
                response_data = response.json()
                if _is_translategemma():
                    return response_data["choices"][0]["text"].strip()
                else:
                    return response_data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.warning(f"Failed to translate chunk, returning original: {type(e).__name__}: {e}")
            return text

    async def _translate_with_chunking(
        self, text: str, target_lang: str, iso_code: str = None, source_lang_code: str = "en"
    ) -> str:
        """Translate long text by splitting into chunks and translating separately."""
        chunks = self._split_text_into_chunks(text, max_chars=2000)

        if logflag:
            logger.info(f"Translating {len(text)} chars in {len(chunks)} chunks to {target_lang}")

        # Translate chunks concurrently
        translated_chunks = await asyncio.gather(
            *[
                self._translate_text_chunk(chunk, target_lang, iso_code, source_lang_code=source_lang_code)
                for chunk in chunks
            ]
        )

        return " ".join(translated_chunks)

    async def handle_request(self, request: Request):
        data = await request.json()

        # Extract and validate propagated Bearer token from Authorization header
        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            token_str = authorization[7:]

            # Defense-in-depth: validate token via JWKS
            from keycloak_token_validator import validate_token

            claims = await validate_token(token_str)
            if claims is None:
                logger.warning("Incoming Bearer token failed JWKS validation — rejecting request")
                return {"error": "Unauthorized", "message": "Token validation failed"}

            self.user_profile_client.set_token(token_str)
        else:
            logger.warning("No Authorization header in request — service-to-service calls will fail")

        # --- LOGGING THE FULL REQUEST FROM THE FRONTEND FOR DEBUGGING---
        logger.debug(f"\n\nFRONTEND PAYLOAD: \n{data}\n\n")

        user_details = {}

        try:
            user_details = await self.user_profile_client.get_user_profile()
        except Exception as e:
            logger.error(f"USER PROFILE ERROR: {e}")

        # -----------------------------------------------

        chat_request = ChatCompletionRequest.model_validate(data)

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
        original_language = None
        if chat_request.context and chat_request.context.language:
            original_language = chat_request.context.language
        elif chat_request.language and chat_request.language != "auto":
            original_language = chat_request.language

        if logflag:
            logger.info(
                f"Language from frontend - context.language: "
                f"{chat_request.context.language if chat_request.context else None}, "
                f"direct language: {chat_request.language}, "
                f"final: {original_language}"
            )
            logger.info(
                f"Language debug - type: {type(original_language)}, "
                f"repr: {repr(original_language)} "
                "if original_language else None"
            )

        # Re-enabled language detection as fallback ---
        try:
            if logflag:
                logger.info(
                    f"Language detection check - original_language is None: "
                    f"{original_language is None}, is empty string: "
                    f"{original_language == '' if original_language else 'N/A'}"
                )

            if not original_language or original_language.strip() == "":
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
                    language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

                    # Only use detected language if it's in our supported list OR if it's 'en'
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
                        if detected_lang.upper() != "EN":
                            original_language = detected_lang.upper()
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

        translated_history_string = ""
        if original_language and original_language.strip() != "EN":
            if logflag:
                logger.debug(
                    f"Original language detected: {original_language}. Proceeding with translation of chat history."
                )
            translated_history_string = await self._get_translated_history_string(
                full_chat_history, "English", source_lang_code=original_language.lower()
            )
        else:
            # If already English, flatten without translation
            if isinstance(full_chat_history, str):
                translated_history_string = full_chat_history
            else:
                parts = [f"{msg.get('role', '').upper()}: {msg.get('content', '')}" for msg in full_chat_history]
                translated_history_string = " |<-MSG->| ".join(parts)

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

        # Multi-turn vector-space blending (issue #833): extract the previous N
        # turns and pass them alongside the query. The EXISTING embedding node
        # embeds both in ONE batched TEI call (E2 design — no separate embed
        # helper, no duplicated embedding logic); align_outputs EMBEDDING blends
        # the two vectors (V = α·EQ + (1-α)·EH). history_text="" disables the
        # blend transparently (flag off / first turn / empty history).
        history_text = ""
        if MULTI_TURN_BLEND_ENABLED and MULTI_TURN_HISTORY_TURNS > 0:
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
            repetition_penalty=chat_request.repetition_penalty if chat_request.repetition_penalty else 1.03,
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
            span.set_attribute("rag.query_length", len(last_translated_message_content))
            span.set_attribute("rag.model_id", _get_llm_model())

            _rag_start = time.time()
            try:
                result_dict, runtime_graph = await self.megaservice.schedule(
                    initial_inputs={
                        "text": last_translated_message_content,
                        # Carried through to the embedding node so it can batch
                        # [query, history] in ONE TEI call. Empty when blending
                        # is disabled (flag off / first turn). Non-EmbedDoc field
                        # is stripped before the retriever HTTP call by OPEA.
                        "_blend_history_text": history_text,
                        "_blend_alpha": MULTI_TURN_BLEND_ALPHA,
                    },
                    llm_parameters=parameters,
                    retriever_parameters=retriever_parameters,
                    reranker_parameters=reranker_parameters,
                    full_chat_history_string=translated_history_string,
                    retrieval_context=retrieval_context,
                    original_language=original_language,
                    user_details=user_details,
                )
                _rag_duration = time.time() - _rag_start

                # Count the chunks fed to the LLM. (Was always 0: node outputs
                # are dicts but the old code used hasattr(dict, "retrieved_docs"),
                # which is always False — docs are a key, not an attribute.)
                span.set_attribute("rag.chunk_count", _count_final_chunks(result_dict))

                # Record custom application metrics
                response_type = "streaming" if chat_request.stream else "sync"
                _metric_attrs = sanitize_attributes(
                    {
                        "response_type": response_type,
                        "abstained": "false",
                        "error": "false",
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                    }
                )
                chat_requests_total.add(1, _metric_attrs)
                chat_rag_duration_seconds.record(_rag_duration, _metric_attrs)

            except Exception as e:
                from opentelemetry.trace import StatusCode

                # Record error metric
                _err_duration = time.time() - _rag_start
                _err_attrs = sanitize_attributes(
                    {
                        "response_type": "streaming" if chat_request.stream else "sync",
                        "abstained": "false",
                        "error": "true",
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                    }
                )
                chat_requests_total.add(1, _err_attrs)
                chat_rag_duration_seconds.record(_err_duration, _err_attrs)

                span.set_status(StatusCode.ERROR)
                span.record_exception(e)
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
                    self._stream_with_metadata(response.body_iterator, result_dict),
                    media_type="text/event-stream",
                )

        llm_response = result_dict.get(self._find_node_key("llm", result_dict), {}).get(
            "text", "Sorry, I could not generate a response."
        )

        # Strip leaked conversation markers + the self-grade sentinel, then translate.
        # Extracted into _finalize_llm_response so the strip-before-translate ordering
        # (the #1 sentinel/translation collision risk) is unit-testable without the
        # full handle_request megaservice flow.
        final_text_response, self_confidence = await self._finalize_llm_response(llm_response, original_language)

        # Assemble source documents + confidence + grounding flag. Reflects the reranker's
        # verdict; not grounded (is_grounded=False) when the reranker found nothing relevant.
        source_documents_formatted, retrieval_confidence, is_grounded = await self._assemble_source_documents(
            result_dict
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
        }
        if LLM_SELF_CONFIDENCE_ENABLED:
            # Raw LLM self-assessed groundedness; None when the sentinel was omitted
            # or malformed.
            metadata["self_confidence"] = round(self_confidence, 2) if self_confidence is not None else None
        # Story 2-7: degradation notice (web search unavailable / below quality)
        _degradation = self._extract_degradation(result_dict)
        if _degradation:
            metadata["degradation"] = _degradation

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
