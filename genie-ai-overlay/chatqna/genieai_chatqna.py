# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import argparse
import ast
import asyncio
import contextlib
import copy
import contextvars
import json
import math
import os
import re
import time
from datetime import date, datetime

from metrics import (
    chat_query_reformulation_failures_total,
    chat_rag_duration_seconds,
    chat_requests_total,
    sanitize_attributes,
)

from core.model_cache import get_model_id
from core.pipeline_settings import load_settings
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
from fastapi.responses import JSONResponse
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
# NLLB sidecar (DEC-25/F6): facebook/nllb-200-3.3B rides a dedicated transformers
# service — target language is a FLORES-200 code (src_lang/forced_bos_token_id),
# which the OpenAI-compatible vLLM API cannot express. Empty → _is_nllb requests
# fail per-call and degrade to translation_unavailable (F4 contract).
NLLB_TRANSLATE_URL = os.getenv("NLLB_TRANSLATE_URL", "")
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
# Default ON since K.7 (10-06): under strict grounding retrieval is the model's
# ONLY knowledge source, so prompt-history alone cannot ground a follow-up
# (compose default + group_vars deploy value are also true — no bare-python
# asymmetry). Query-time feature; UNRELATED to ingest-time
# CONTEXTUAL_RETRIEVAL_ENABLED. Under the default production config
# (HYBRID_RETRIEVAL_ENABLED=false), the retriever is dense-only so the blended
# vector controls all retrieval. When hybrid is explicitly enabled (opt-in),
# only the dense leg is blended — the BM25 lexical leg still uses the isolated
# query text (K.7b reformulation now resolves that gap at the query itself).
MULTI_TURN_BLEND_ENABLED = (
    os.getenv("MULTI_TURN_BLEND_ENABLED", "true").strip().lower() in ("true", "1", "t", "y", "yes")
)
MULTI_TURN_BLEND_ALPHA = float(os.getenv("MULTI_TURN_BLEND_ALPHA", "0.7"))
MULTI_TURN_HISTORY_TURNS = int(os.getenv("MULTI_TURN_HISTORY_TURNS", "1"))
# K.7b conversational query reformulation: when history exists, ONE small
# granite call rewrites the follow-up into a self-contained query BEFORE
# retrieval so BOTH retrieval legs (dense + BM25) and the KB question line
# see the resolved subject ("how much do I need of that" -> "How much CAMIX
# herbicide..."). Default ON (deploy kill-switch via env; failure of the
# call always falls back to the raw query — chat must never break).
# Boolean parse = the module's true-set idiom (_traversal_wire_value): "1"/"yes"/"on"-class
# values must not silently parse as disabled while compose/README say default-ON.
QUERY_REFORMULATION_ENABLED = (
    os.getenv("QUERY_REFORMULATION_ENABLED", "true").strip().lower() in ("true", "1", "t", "y", "yes")
)
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
# G.3 (FR7) SSOT default for the anti-repetition decode knob — handle_request
# fills it into LLMParams when the request carries no repetition_penalty;
# per-request values still win. 1.03 to start; tune via the G.5 epic-DoD probe.
# Parsed defensively: a typo'd env value must degrade to the default with a
# WARNING, never crash-loop the container at import.
_repetition_penalty_env = os.getenv("CHATQNA_REPETITION_PENALTY", "1.03")
try:
    REPETITION_PENALTY_DEFAULT = float(_repetition_penalty_env)
    if not math.isfinite(REPETITION_PENALTY_DEFAULT):
        raise ValueError("not a finite number")
except ValueError:
    logger.warning(
        f"CHATQNA_REPETITION_PENALTY={_repetition_penalty_env!r} is not a finite "
        f"number — falling back to 1.03"
    )
    REPETITION_PENALTY_DEFAULT = 1.03

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


# ISO 639-1 → FLORES-200 for the NLLB sidecar. Deliberately tiny — this is the
# app's entire language set. The backend's nllb-200-map.js is the only full
# 200-language registry (F6 boundary); widen here only when the app grows one.
_NLLB_FLORES_MAP = {"en": "eng_Latn", "st": "sot_Latn"}


def _nllb_flores_code(iso_code: str) -> str:
    """Map an ISO 639-1 code to a FLORES-200 code; unknown raises.

    Never a silent default (F4 law): an unknown TARGET rendered as eng_Latn
    would present English as the requested language. The raise rides the same
    raise_on_error/original-text contract as a dead sidecar.
    """
    code = _NLLB_FLORES_MAP.get((iso_code or "").lower())
    if not code:
        logger.warning(f"NLLB: no FLORES code for ISO '{iso_code}' — failing this translation")
        raise ValueError(f"no FLORES code for ISO '{iso_code}'")
    return code


def _is_nllb() -> bool:
    """True when the active translation model is NLLB-200 (DEC-25).

    NLLB is served by the nllb-translate sidecar, which speaks FLORES-200
    codes natively — never the OpenAI chat API (it is not an LLM).
    """
    return "nllb" in _get_translation_model_id().lower()


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", None)


def _translation_auth_headers() -> dict:
    """Authorization headers for translation-service calls, or ``{}`` when no key.

    The NLLB sidecar is internal and needs no auth (the backend's authless JS
    client gets 200s). An UNCONDITIONAL ``Bearer {OPENAI_API_KEY}`` becomes the
    illegal value ``"Bearer "`` when the key is unset/empty — httpx raises
    LocalProtocolError locally, the request never leaves chatqna, and BOTH
    translation legs (history st→en and finalize en→st) die with it (live
    G.5, rtx6000). Keyed remote endpoints still get their header when the key
    exists, so an empty-Bearer value is unrepresentable.
    """
    if isinstance(OPENAI_API_KEY, str) and OPENAI_API_KEY:
        return {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    return {}

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


# K.7b reformulation call budget: strict by design — a hung rewriter must cost
# at most ~5s total (httpx.Timeout caps EVERY phase at 5s, connect at 2s) and
# never produce an essay.
_QUERY_REFORMULATION_TIMEOUT = httpx.Timeout(5.0, connect=2.0)
_QUERY_REFORMULATION_MAX_TOKENS = 64
_QUERY_REFORMULATION_MAX_CHARS = 500


async def _reformulate_query(query, translated_history):
    """K.7b: rewrite a conversational follow-up into a self-contained query.

    ONE small chat-completions call to the SAME vLLM the answer LLM uses
    (granite; the httpx + Bearer idiom is the translation calls'), with the
    last 2 history turns (via :func:`_extract_history_text`) as context.
    Feeds retrieval (both legs) + the KB question line; history/UI keep the
    original text. The rewrite is ALWAYS English — the embedding space and
    corpus are English (bge-base-en-v1.5), so a native-language rewrite would
    degrade retrieval even when the user's turn was translated.

    Returns the rewritten one-line query, or ``None`` when the call must not
    run (first turn: no prior history → zero added latency) or failed
    (timeout, non-200, or garbage output) — callers fall back to the raw
    query; a broken rewriter never breaks chat.
    """
    history = _extract_history_text(translated_history, 2)
    if not history:
        return None  # first turn — no reformulation call at all
    prompt = (
        "Rewrite the user's latest chat question as ONE self-contained question "
        "that can be understood without the chat history. Resolve pronouns and "
        'vague references ("that", "it") using the chat history. Keep the '
        "question's intent and specifics. Always write the rewritten question "
        "in English.\n\n"
        f"CHAT HISTORY:\n{history}\n\n"
        f"LATEST QUESTION: {query}\n\n"
        "Return ONLY the rewritten question, one line, no preamble."
    )
    payload = {
        "model": _get_llm_model(),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": _QUERY_REFORMULATION_MAX_TOKENS,
        "stream": False,
    }
    # Same endpoint the LLM node's MicroService uses (LLM_SERVER_* env incl.
    # the remote-GPU VLLM_LLM_ENDPOINT override) — NOT the translation pair
    # (NLLB sidecar / OPEA proxy), which serve a different model.
    url = (
        f"{LLM_SERVER_PROTOCOL}://{LLM_SERVER_HOST_IP}:{LLM_SERVER_PORT}"
        f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions"
    )
    try:
        async with httpx.AsyncClient(timeout=_QUERY_REFORMULATION_TIMEOUT) as client:
            response = await client.post(url, json=payload, headers=_translation_auth_headers())
            response.raise_for_status()
            raw = response.json()["choices"][0]["message"]["content"]
    except Exception as e:
        logger.warning(f"[K.7b] Query reformulation failed ({e!r}) — falling back to the raw query")
        chat_query_reformulation_failures_total.add(1)
        return None
    # vLLM returns content=null on token-cap/content-filter truncation —
    # str(None) would pass every shape check and retrieve on the literal
    # string "None". Non-string/None = failure, not a query.
    if not isinstance(raw, str):
        logger.warning(
            f"[K.7b] Query reformulation returned non-string content ({raw!r}) "
            "— falling back to the raw query"
        )
        chat_query_reformulation_failures_total.add(1)
        return None
    rewritten = raw.strip().strip('"').strip()
    is_multiline = "\n" in rewritten
    if not rewritten or is_multiline or len(rewritten) > _QUERY_REFORMULATION_MAX_CHARS:
        logger.warning(
            f"[K.7b] Query reformulation returned garbage "
            f"(empty={not rewritten}, multiline={is_multiline}, "
            f"chars={len(rewritten)}) — falling back to the raw query"
        )
        chat_query_reformulation_failures_total.add(1)
        return None
    return rewritten


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
# Streaming degeneration guard (G.4, FR1/FR8 — the 10-01 "go tloga" x300 live
# failure). A stream whose accumulated text ends in a consecutive n-gram loop
# is stopped, trimmed, and marked in the metadata event — never yielded whole,
# never persisted as a cleanly answered query.
# ---------------------------------------------------------------------------
# Longest n-gram (in words) considered as a looping unit. Loops longer than a
# short phrase are not degeneration worth guarding at this threshold.
DEGENERATION_MAX_NGRAM = 8
# Consecutive repetitions of that n-gram that confirm degeneration. Deliberately
# conservative: legitimate agricultural answers (lists, crop names, repeated
# section headers) never repeat one n-gram 6 times in a row.
DEGENERATION_CONFIRM_REPS = 6.0


def _scan_degeneration(text: str, max_ngram: int = DEGENERATION_MAX_NGRAM):
    """Pure detector for a repetition loop at the end of ``text``.

    Returns ``None`` or ``(hold_char, confirmed)``:

    * ``None`` — no n-gram (1..max_ngram words) repeats consecutively at the
      end of the text; everything scanned is safe to emit.
    * ``(hold_char, False)`` — the tail repeats an n-gram 2+ times but is below
      the confirm threshold: a streaming emitter must withhold everything from
      ``hold_char`` (the start of the SECOND repetition) onward.
    * ``(hold_char, True)`` — degenerate loop confirmed (>=
      ``DEGENERATION_CONFIRM_REPS`` repetitions): stop the stream, drop
      everything from ``hold_char``, mark the answer truncated.

    Word-based and split-chunk-safe: the scan also runs on the text minus its
    last word, so a loop whose unit is split across token chunks (the final
    word is still incomplete) is still recognized. Units made purely of
    punctuation/dashes (markdown table rows) never confirm — only units
    containing at least one alphabetic word can be degenerate loops.
    """
    # Char offsets of each whitespace-separated word (needed to map a word
    # index back to an exact cut position without disturbing whitespace).
    starts = []
    words = []
    i, n = 0, len(text)
    while i < n:
        if text[i].isspace():
            i += 1
            continue
        j = i
        while j < n and not text[j].isspace():
            j += 1
        starts.append(i)
        words.append(text[i:j])
        i = j

    best = None  # (suffix_words, period, suffix_start_word_index)
    # Second pass drops the last word: it may be split across chunks and not
    # yet complete, which would otherwise break the suffix-periodicity check.
    for base_words in (words, words[:-1]):
        W = len(base_words)
        for p in range(1, max_ngram + 1):
            if W < 2 * p:
                break
            k = p
            while k < W and base_words[W - k - 1] == base_words[W - k - 1 + p]:
                k += 1
            if k >= 2 * p and (best is None or k > best[0]):
                unit = base_words[W - k : W - k + p]
                if not any(any(c.isalpha() for c in w) for w in unit):
                    continue  # punctuation-only rhythm (tables) — not a loop
                best = (k, p, W - k)
    if best is None:
        return None
    k, p, suffix_start = best
    hold_char = starts[suffix_start + p]
    return hold_char, k >= p * DEGENERATION_CONFIRM_REPS


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
    "Retrieved Documents support your reply (100 = fully grounded, 0 = not). if you find the right document don't be scared of giving it 90-100 score \n"
    "Example:\n"
    "User: What soil for cucumber?\n"
    "Assistant: Cucumber grows best in well-drained sandy loam (pH 5.5-6.8).\n"
    "[[CONF:100]]\n"
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
CHATQNA_ENFORCE_ABSTENTION = os.getenv("CHATQNA_ENFORCE_ABSTENTION", "") or "true"
CHATQNA_ABSTENTION_INSTRUCTIONS = os.getenv("CHATQNA_ABSTENTION_INSTRUCTIONS", "").strip() or None

# K.2: the ONE deduplicated abstention fallback. Two sites used to carry
# divergent texts ("[Returned Documents]" vs "[Retrieved Documents]"); the
# reranker-path wording wins because production runs with reranking and the
# docs are assembled as `[Retrieved Document]` entries.
_ABSTENTION_INSTRUCTIONS_DEFAULT = (
    "\n[Retrieved Documents] The knowledge base search did not return any results. "
    "State clearly that you cannot answer based on available information."
)

# K.2 (DEC-29): documented defaults for llm-settings.json — TODAY'S EFFECTIVE
# values, so seeding the file changes nothing until an admin edits. Env vars
# above are the SEED tier only; once the file exists it is the source of truth
# (K.1 precedence law). Generation numbers mirror the deployed compose values
# (MAX_MODEL_LEN_TEXTGEN=8192, CHATQNA_REPETITION_PENALTY=1.03).
_LLM_DEFAULTS = {
    "systemPrompt": _CHATQNA_SYSTEM_PROMPT_BASE,
    "enforceAbstention": str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true",
    "abstentionInstructions": CHATQNA_ABSTENTION_INSTRUCTIONS,
    "generation": {
        "temperature": 0.01,
        "topP": 0.95,
        "repetitionPenalty": REPETITION_PENALTY_DEFAULT,
        "frequencyPenalty": 0.0,
        "presencePenalty": 0.0,
        "maxTokens": MAX_MODEL_LEN_TEXTGEN,
    },
}


_bad_settings_ref = None  # last settings dict we already WARNed about (once-per-state guard)
# Distinct file maxTokens values already WARNed about (once-per-value guard).
_MAX_TOKENS_CLAMP_WARNED: set = set()


def _llm_settings() -> dict:
    """Per-request LLM settings (K.2): file values over :data:`_LLM_DEFAULTS`.

    mtime/ino-guarded by the K.1 reader, so calling this on every request is
    cheap and an admin edit applies with no restart. A missing/corrupt file
    WARNs once and degrades to the coded defaults (never a crashed chat).

    K.1 never-crash law, typed-field leg: a PARSEABLE file with wrong-typed
    values (systemPrompt: 5, generation.temperature: "hot" — hand edits) would
    TypeError at the consumer (prompt concat / numeric use), so any mismatch
    in the known fields WARNs (once per file state) and degrades the WHOLE
    document to a copy of the coded defaults.
    """
    settings = load_settings("LLM_SETTINGS_CONFIG", _LLM_DEFAULTS)

    def degrade(reason: str) -> dict:
        global _bad_settings_ref
        if settings is not _bad_settings_ref:
            _bad_settings_ref = settings
            logger.warning(
                "llm-settings %s — using coded defaults (K.1 never-crash law)", reason
            )
        return dict(_LLM_DEFAULTS)

    for key, expected in (("systemPrompt", str), ("enforceAbstention", bool)):
        if not isinstance(settings.get(key), expected):
            return degrade(f"field '{key}' is {type(settings.get(key)).__name__}, expected {expected.__name__}")
    # A whitespace-only prompt passes the str check but leaves every chat
    # rule-less — treat it as absent (same degrade path as a wrong type).
    if not settings["systemPrompt"].strip():
        return degrade("field 'systemPrompt' is empty or whitespace-only")
    if not isinstance(settings.get("abstentionInstructions"), (str, type(None))):
        return degrade("field 'abstentionInstructions' is not a string or null")
    gen = settings.get("generation")
    if not isinstance(gen, dict):
        return degrade("field 'generation' is not an object")
    for key in _LLM_DEFAULTS["generation"]:
        value = gen.get(key)
        # bool is an int subclass — True is not a valid maxTokens
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return degrade(f"field 'generation.{key}' is {type(value).__name__}, expected a number")
    return settings


def _clamped_file_max_tokens(headroom: int = 512) -> int:
    """The file's ``generation.maxTokens`` clamped into the model-length budget.

    ``headroom`` tokens are reserved below ``MAX_MODEL_LEN_TEXTGEN``: the
    truncation math uses the 512 default (a raw value above that would drive
    ``max_history_tokens`` negative and silently drop ALL chat history);
    the outbound wire value passes 0 (``max_tokens == max_model_len`` is
    legal — vLLM truncates to the remaining context — but nothing above,
    and vLLM's own clamp is not relied on). WARN once per distinct value
    (loud law without per-request spam).
    """
    raw = _llm_settings()["generation"]["maxTokens"]
    # Floor at 1: a sub-headroom MAX_MODEL_LEN_TEXTGEN (e.g. 300 with the
    # 512 truncation headroom) would otherwise produce a negative budget.
    effective = max(1, min(raw, MAX_MODEL_LEN_TEXTGEN - headroom))
    if effective != raw and raw not in _MAX_TOKENS_CLAMP_WARNED:
        _MAX_TOKENS_CLAMP_WARNED.add(raw)
        logger.warning(
            "llm-settings generation.maxTokens=%s exceeds the model-length budget "
            "(MAX_MODEL_LEN_TEXTGEN=%s) — clamping to %s (answer budget AND the "
            "outbound max_tokens; vLLM's own clamp is not relied on)",
            raw,
            MAX_MODEL_LEN_TEXTGEN,
            effective,
        )
    return effective


# K.3 (DEC-29): documented defaults for rag-tuning.json. Precedence (B3):
# FILE > ENV-SEED > coded — every default reads its env var at import (the
# seed tier, exactly how K.2's _LLM_DEFAULTS env-seeds CHATQNA_SYSTEM_PROMPT)
# with TODAY'S EFFECTIVE value as the fallback, pinned from
# docker-compose.yaml at seed-writing time. Wherever the compose value
# differs from the old coded os.getenv default, COMPOSE wins as the
# fallback (chatqna: k 4→20, fetch_k 20→30, score_threshold 0.1→0.2,
# traversal false→true, returned 3→5, t-threshold 0.5→0.7; reranker trio
# adaptive/0.9→slice/0.75). filterStrategy reads the DEPLOY env name
# (RETRIEVER_ARANGO_FILTER_STRATEGY) — config.py's ARANGO_FILTER_STRATEGY
# was the dead name K.3 retired. traversalConcurrentBatches fallback = the
# retriever's HARD CAP (4; compose said 10 and the retriever capped anyway
# — the lie K.3 fixed in compose). Value-identical copies of this dict live
# in the other reader modules (one _RAG_DEFAULTS per consuming module — the
# K.1 reader cache is keyed by path only, so every reader of this file must
# merge over the same defaults; the env names are shared and compose sets
# identical values everywhere it sets them at all).
_RAG_DEFAULTS = {
    "retriever": {
        "retrievalK": int(os.getenv("RETRIEVER_ARANGO_K", "20")),
        "fetchK": int(os.getenv("RETRIEVER_ARANGO_FETCH_K", "30")),
        "scoreThreshold": float(os.getenv("RETRIEVER_ARANGO_SCORE_THRESHOLD", "0.2")),
        "lambdaMult": float(os.getenv("RETRIEVER_ARANGO_LAMBDA_MULT", "0.5")),
        "searchStart": os.getenv("RETRIEVER_ARANGO_SEARCH_START", "chunk"),
        "searchMode": os.getenv("RETRIEVER_ARANGO_SEARCH_MODE", "vector"),
        "filterStrategy": os.getenv("RETRIEVER_ARANGO_FILTER_STRATEGY", "OR"),
        "enableTraversal": os.getenv("RETRIEVER_ARANGO_TRAVERSAL_ENABLED", "true").lower() == "true",
        "traversalMaxDepth": int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH", "2")),
        "traversalMaxReturned": int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED", "5")),
        "traversalScoreThreshold": float(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD", "0.7")),
        "traversalConcurrentBatches": int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES", "4")),
        "hybridEnabled": os.getenv("RETRIEVER_HYBRID_RETRIEVAL_ENABLED", "true").lower() == "true",
        "hybridRrfK": int(os.getenv("RETRIEVER_HYBRID_RRF_K", "60")),
        "hybridDenseWeight": float(os.getenv("RETRIEVER_HYBRID_DENSE_WEIGHT", "1.0")),
        "hybridLexicalWeight": float(os.getenv("RETRIEVER_HYBRID_LEXICAL_WEIGHT", "1.0")),
        "hybridBm25Candidates": int(os.getenv("RETRIEVER_HYBRID_BM25_CANDIDATES", "50")),
    },
    "reranker": {
        "strategy": os.getenv("RERANKING_STRATEGY", "slice"),
        "threshold": float(os.getenv("RERANKING_THRESHOLD", "0.75")),
        "topN": int(os.getenv("RERANKER_TOP_N", "3")),
        "noveltySigmoidA": float(os.getenv("NOVELTY_SIGMOID_A", "20.0")),
        "noveltySigmoidB": float(os.getenv("NOVELTY_SIGMOID_B", "0.25")),
        "contextDecayFactor": float(os.getenv("CONTEXT_DECAY_FACTOR", "0.0025")),
        "minValueThreshold": float(os.getenv("MIN_VALUE_THRESHOLD", "-1.0")),
    },
}

# Enum fields validated against the exact pipeline branch values, so a
# hand-edited file can never inject an invalid strategy/mode past the guard.
_RAG_ENUMS = {
    ("retriever", "searchStart"): ("chunk", "edge", "node"),
    ("retriever", "searchMode"): ("vector", "hybrid"),
    ("retriever", "filterStrategy"): ("AND", "OR"),
    ("reranker", "strategy"): ("slice", "threshold", "knee_threshold", "slice_threshold", "adaptive"),
}

_rag_bad_ref = None  # last settings dict we already WARNed about (once-per-state guard)


def _rag_settings() -> dict:
    """Per-request RAG tuning (K.3): file values over :data:`_RAG_DEFAULTS`.

    Same contract as :func:`_llm_settings` — mtime/ino-guarded by the K.1
    reader, loud once-per-state WARN + whole-document degrade to the coded
    defaults on any wrong-typed or invalid-enum field (the K.1 never-crash
    law, typed-field leg: a parseable file with ``retrievalK: "many"`` must
    not TypeError at the consumer).
    """
    settings = load_settings("RAG_TUNING_CONFIG", _RAG_DEFAULTS)

    def degrade(reason: str) -> dict:
        global _rag_bad_ref
        if settings is not _rag_bad_ref:
            _rag_bad_ref = settings
            logger.warning(
                "rag-tuning %s — using coded defaults (K.1 never-crash law)", reason
            )
        return dict(_RAG_DEFAULTS)

    for section, fields in _RAG_DEFAULTS.items():
        block = settings.get(section)
        if not isinstance(block, dict):
            return degrade(f"section '{section}' is {type(block).__name__}, expected an object")
        for key, default in fields.items():
            value = block.get(key)
            enum = _RAG_ENUMS.get((section, key))
            if enum is not None:
                ok = isinstance(value, str) and value in enum
            elif isinstance(default, bool):
                ok = isinstance(value, bool)
            elif isinstance(default, int):
                # bool is an int subclass — True is not a valid retrievalK
                ok = isinstance(value, int) and not isinstance(value, bool)
            else:
                # NaN/Infinity literals parse as JSON numbers — they must
                # not pass and silently steer RRF/sigmoid/adaptive math.
                ok = (
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(value)
                )
            if not ok:
                return degrade(
                    f"field '{section}.{key}' is {value!r} "
                    f"(expected {'one of ' + repr(enum) if enum else type(default).__name__})"
                )
    return settings


def _traversal_wire_value(value) -> str:
    """Canonical wire form of ``enable_traversal``: parse as a REAL bool
    first (the retriever ``config.get_boolean_env_var`` idiom), then
    stringify. The raw string "false" is truthy at the retriever's
    ``if enable_traversal:`` gate — stringifying an unparsed value would
    keep a disabled traversal enabled (the string-truthiness bug K.3 fixes).
    """
    if isinstance(value, bool):
        flag = value
    else:
        flag = str(value).strip().lower() in ("true", "1", "t", "y", "yes")
    return str(flag).lower()


def _resolve_rag_parms(chat_request) -> tuple[dict, dict]:
    """K.3: retriever + reranker parms resolve request-explicit > settings
    file > coded defaults (mirrors :func:`_resolve_llm_gen_params`).

    Returns the ``(retriever_kwargs, reranker_kwargs)`` constructor dicts for
    ``GenieaiRetrieverParms`` / ``GenieaiRerankerParms``. chatqna is the
    AUTHORITATIVE retriever-parm sender — every retriever field resolved
    here travels in the /v1/retrieval body, so the file values are the
    effective ones at the retriever. The ONE resolved reranker strategy
    feeds BOTH requests so the retriever's adaptive embedding-attachment
    gate and the reranker itself can never disagree.
    """
    _rag = _rag_settings()
    _rag_ret = _rag["retriever"]
    _rag_rr = _rag["reranker"]
    _resolved_strategy = (
        chat_request.reranking_strategy
        if chat_request.reranking_strategy is not None
        else _rag_rr["strategy"]
    )
    retriever_kwargs = dict(
        # in the current implementation, search_type should always be set to
        # similarity_score_threshold, otherwise not possible to calculate
        # confidence scores (enforced by the ChatCompletionRequest model).
        search_type=chat_request.search_type if chat_request.search_type else "similarity_score_threshold",
        k=chat_request.k if chat_request.k is not None else _rag_ret["retrievalK"],
        fetch_k=chat_request.fetch_k if chat_request.fetch_k is not None else _rag_ret["fetchK"],
        search_start=chat_request.search_start if chat_request.search_start is not None else _rag_ret["searchStart"],
        # enable_traversal is a string field on the wire: parse the
        # file/request value as a REAL bool first, then stringify — "false"
        # is truthy as a raw string (string-truthiness bug).
        enable_traversal=_traversal_wire_value(
            chat_request.enable_traversal
            if chat_request.enable_traversal is not None
            else _rag_ret["enableTraversal"]
        ),
        traversal_max_depth=chat_request.traversal_max_depth
        if chat_request.traversal_max_depth is not None
        else _rag_ret["traversalMaxDepth"],
        traversal_max_returned=chat_request.traversal_max_returned
        if chat_request.traversal_max_returned is not None
        else _rag_ret["traversalMaxReturned"],
        traversal_score_threshold=chat_request.traversal_score_threshold
        if chat_request.traversal_score_threshold is not None
        else _rag_ret["traversalScoreThreshold"],
        # Dead knob (K.3 research): chatqna sends distance_threshold but the
        # retriever never reads it. Left on the wire unchanged, NOT exposed
        # in the settings file — leave the wire alone.
        distance_threshold=chat_request.distance_threshold
        if chat_request.distance_threshold is not None
        else RETRIEVER_DISTANCE_THRESHOLD,
        lambda_mult=chat_request.lambda_mult if chat_request.lambda_mult is not None else _rag_ret["lambdaMult"],
        score_threshold=chat_request.score_threshold
        if chat_request.score_threshold is not None
        else _rag_ret["scoreThreshold"],
        # K.3: thread the resolved reranker strategy into the retriever
        # request so the retriever's adaptive embedding-attachment gate
        # runs on the per-request value, not its own env by accident.
        reranking_strategy=_resolved_strategy,
    )
    reranker_kwargs = dict(
        reranking_strategy=_resolved_strategy,
        top_n=chat_request.top_n if chat_request.top_n is not None else _rag_rr["topN"],
        reranking_threshold=chat_request.reranking_threshold
        if chat_request.reranking_threshold is not None
        else _rag_rr["threshold"],
    )
    return retriever_kwargs, reranker_kwargs


def _resolve_llm_gen_params(chat_request) -> dict:
    """K.2: generation params resolve request-explicit > settings file > coded.

    ``model_fields_set`` (not truthiness) decides "explicit": the protocol
    model bakes non-None defaults (temperature=0.01, repetition_penalty=1.0),
    so a truthiness check both shadowed the file with those baked values and
    silently replaced an explicit temperature/frequency_penalty of 0 with the
    default (the falsy-zero bug). An explicit JSON ``null`` (the OpenAI
    "unset" convention) lands in ``model_fields_set`` with value None — it
    must NOT beat the file, so None falls through to the file/coded value.
    """
    gen = _llm_settings()["generation"]
    set_fields = getattr(chat_request, "model_fields_set", None) or frozenset()

    def pick(request_field: str, settings_key: str):
        if request_field in set_fields:
            value = getattr(chat_request, request_field)
            if value is not None:
                return value
        return gen[settings_key]

    # Outbound max_tokens: request-explicit passes through untouched (the
    # caller owns it); every file-sourced value — including the explicit-null
    # fallback — is clamped by _clamped_file_max_tokens, so the wire never
    # carries a schema-legal 32768 against an 8192 model.
    explicit_max = "max_tokens" in set_fields and chat_request.max_tokens is not None

    return dict(
        top_k=chat_request.top_k if chat_request.top_k else 10,
        top_p=pick("top_p", "topP"),
        temperature=pick("temperature", "temperature"),
        frequency_penalty=pick("frequency_penalty", "frequencyPenalty"),
        presence_penalty=pick("presence_penalty", "presencePenalty"),
        repetition_penalty=pick("repetition_penalty", "repetitionPenalty"),
        stream=chat_request.stream if chat_request.stream else False,
        # maxTokens honesty (K.2 review): the file value is the real outbound
        # default now — request-explicit still wins; file-sourced values take
        # the same model-length clamp as the truncation math.
        max_tokens=(
            chat_request.max_tokens
            if explicit_max
            else _clamped_file_max_tokens(headroom=0)
        ),
    )
SENSITIVE_KEYS = set(os.getenv("SENSITIVE_KEYS", "").split(","))
WEATHER_AUGMENTATION_ENABLED = os.getenv("WEATHER_AUGMENTATION_ENABLED", "true").lower() == "true"
WEATHER_DEFAULT_LATITUDE = float(os.getenv("WEATHER_DEFAULT_LATITUDE", "-29.3167"))
WEATHER_DEFAULT_LONGITUDE = float(os.getenv("WEATHER_DEFAULT_LONGITUDE", "27.4833"))
WEATHER_CACHE_TTL_SECONDS = int(os.getenv("WEATHER_CACHE_TTL_SECONDS", "900"))


# J.1: markdown structure that must never be sent through NLLB — its
# tokenizer spaces whatever it touches (``**bold**`` → ``** bold **``), which
# marked then renders literally. Line prefixes are kept verbatim; only the
# human-readable spans between markers are translated.
_MD_LINE_PREFIX_RE = re.compile(r"^(\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)?)")
_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
# J.1 review: protect every inline marker NLLB would space — code, links
# (incl. titled), strikethrough, and both italic forms.
_MD_VERBATIM_RE = re.compile(
    r"`[^`\n]+`|\[[^\]]*\]\([^)]*\)|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_"
)


def _split_inline_segments(text: str) -> list[tuple[str, bool]]:
    """Split marker-free-position inline text into (text, translatable)
    segments. ``**`` markers split into keep + content; verbatim spans
    (code/links/italics/strike) are kept whole; bold CONTENT is recursed so
    a verbatim span nested inside bold also survives (J.1 review)."""

    def add_text(segments: list[tuple[str, bool]], s: str) -> None:
        stripped = s.strip()
        lead = s[: len(s) - len(s.lstrip())]
        trail = s[len(s.rstrip()) :]
        if lead:
            segments.append((lead, False))
        if stripped:
            segments.append((stripped, True))
        if trail:
            segments.append((trail, False))

    segments: list[tuple[str, bool]] = []
    idx = 0
    while idx < len(text):
        bold = _MD_BOLD_RE.search(text, idx)
        verbatim = _MD_VERBATIM_RE.search(text, idx)
        if bold and (not verbatim or bold.start() <= verbatim.start()):
            if bold.start() > idx:
                add_text(segments, text[idx : bold.start()])
            segments.append(("**", False))
            segments.extend(_split_inline_segments(bold.group(1)))
            segments.append(("**", False))
            idx = bold.end()
        elif verbatim:
            if verbatim.start() > idx:
                add_text(segments, text[idx : verbatim.start()])
            segments.append((verbatim.group(0), False))
            idx = verbatim.end()
        else:
            add_text(segments, text[idx:])
            break
    return segments


def _split_line_translation_segments(line: str) -> list[tuple[str, bool]]:
    """Split one markdown line into ``(text, translatable)`` segments.

    Leading markdown prefixes (list bullets/numbers, headings, quotes), the
    ``**`` bold markers, inline-code/links/italics spans, and the whitespace
    MARGINS around translatable spans are KEPT verbatim (the sidecar strips
    every text it translates — margins must not ride along); plain text and
    bold CONTENT are marked translatable.

    A line with an UNEVEN number of ``**`` markers (bold spanning a line
    break, or a stray marker) is kept verbatim entirely — sending a
    half-marker span to NLLB is what produced the literal-asterisk artifact
    (J.1 review).
    """
    if line.count("**") % 2 == 1:
        return [(line, False)]
    prefix = _MD_LINE_PREFIX_RE.match(line)
    segments: list[tuple[str, bool]] = (
        [(line[: prefix.end()], False)] if prefix.end() else []
    )
    segments.extend(_split_inline_segments(line[prefix.end():]))
    return segments


def _split_overlong_segment(text: str, max_chars: int = 2000) -> list[str]:
    """Split a translatable segment that exceeds the per-text cap.

    The sidecar rejects texts over MAX_TEXT_CHARS (4000) with a 400 — one
    huge paragraph would kill its whole batch (stream: the entire ST
    answer). Sentence-split like the old chunker did; a sentence with no
    ``. `` boundaries is word-split as a last resort. Pieces rejoin with
    spaces INSIDE the segment — the line-level structure is untouched.
    """
    if len(text) <= max_chars:
        return [text]
    pieces: list[str] = []
    current = ""
    for sentence in text.split(". "):
        candidate = (current + ". " + sentence) if current else sentence
        if len(candidate) > max_chars and current:
            pieces.append(current)
            current = sentence
        else:
            current = candidate
        while len(current) > max_chars:  # no sentence boundaries — word split
            words = current.split(" ")
            chunk = ""
            for w in words:
                if len(chunk) + len(w) + 1 > max_chars and chunk:
                    break
                chunk = (chunk + " " + w) if chunk else w
            pieces.append(chunk)
            current = current[len(chunk):].lstrip()
    if current:
        pieces.append(current)
    return pieces


def _is_translatable_text(text: str) -> bool:
    """Only spans containing Latin letters are sent to the translator —
    syntax-only text (``---``, stray numbers) must not round-trip the model."""
    return bool(re.search(r"[A-Za-zÀ-ÿ]", text))


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
    # K.3: the resolved reranker strategy rides the retriever request so the
    # retriever's adaptive embedding-attachment gate runs on the per-request
    # value (chatqna never forwarded it — the gate fell back to the
    # retriever's own env by accident).
    reranking_strategy: str = RERANKING_STRATEGY


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


# I.4 review F3: per-request token storage (see GenieUserProfileClient._token).
_request_token: contextvars.ContextVar[str | None] = contextvars.ContextVar("chatqna_request_token", default=None)

class GenieUserProfileClient:
    """
    Client for fetching User Profile data from the Backend Service.
    Designed to be used within the ChatQnA orchestrator.

    Auth: Bearer token propagated from the backend (JWKS-validated).
    """

    def __init__(self):
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")

    # I.4 review F3: the client is a SINGLETON but tokens are PER-REQUEST — instance
    # state bled one user's Bearer into a concurrent request (profile/context
    # enrichment is user-specific). A ContextVar is isolated per asyncio task, so
    # concurrent FastAPI requests each see their own token. Reads keep using
    # `._token` via the property; set_token sets the var.
    @property
    def _token(self):
        return _request_token.get()

    def set_token(self, token: str):
        _request_token.set(token)

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
            # Live-500 lesson (10-06): label encoding must NEVER fail a chat —
            # a malformed label degrades to UNFILTERED retrieval (WARN), the
            # same fail-open law the retriever's decode side follows.
            try:
                inputs["search_start"] = encode_filter_labels(_base_mode, _filter_labels)
            except ValueError as e:
                logger.warning(
                    f"[LABEL-CONTRACT] dropping retrieval filter labels "
                    f"(unencodable: {e!r}) — proceeding unfiltered"
                )

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
        # K.2: file-driven system prompt (per request, no restart) + the boot-time
        # self-confidence suffix (env-gated flag stays boot-only by spec).
        system_instructions = _llm_settings()["systemPrompt"] + (
            _CHATQNA_SELF_CONF_INSTRUCTION if LLM_SELF_CONFIDENCE_ENABLED else ""
        )

        # CRITICAL (DEC-26): the English-response rule is UNCONDITIONAL — every
        # session, any original_language. Output language is the translation
        # layer's job (F4): the ST answer is the translation of this English
        # answer, and when history translation fails (sidecar down) this rule is
        # what keeps the LLM from mirroring the user's language back at them.
        original_language = kwargs.get("original_language")
        system_instructions = (
            "\n\nMANDATORY: You MUST respond ONLY in English. "
            "Do NOT respond in Sesotho or any other language. "
            "All responses must be in English regardless of the "
            "content language.\n\n" + system_instructions
        )
        if logflag:
            logger.info(
                f"[LANGUAGE DEBUG] Injected ENGLISH instruction into "
                f"system prompt for ALL sessions per DEC-26 "
                f"(original_language={original_language})"
            )

        # DEBUG: Log the system prompt to verify it's loaded correctly
        if logflag:
            logger.info(
                f"\n[SYSTEM PROMPT DEBUG] file-driven system prompt assembled: {'YES' if system_instructions else 'NO'}"
            )
            if system_instructions:
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt length: {len(system_instructions)} chars")
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt preview: {system_instructions[:500]}...")
            else:
                logger.error("[SYSTEM PROMPT DEBUG] system prompt is empty after file-driven assembly!")

        weather_context_string = kwargs.get("weather_context", "")
        weather_section = f"\n\nCURRENT WEATHER DATA:\n{weather_context_string}" if weather_context_string else ""
        prompt_add_context = (
            f"\n\nUSER INFORMATION:\n{user_context_string}"
            f"{weather_section}"
            f"\n\nCHAT HISTORY:\n{translated_history_string}"
            # K.7b: docs-first, QUESTION line last (inside rag_augmented_prompt,
            # built by _build_rag_prompt) — adjacent to the answer instruction.
            f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}"
        )

        # FIX: Separate system and user content for proper chat template handling
        user_content = prompt_add_context

        tokenizer = get_tokenizer()
        max_model_tokens = MAX_MODEL_LEN_TEXTGEN
        # K.2: the answer-budget fallback reads the file's generation.maxTokens
        # CLAMPED into the model-length budget (_clamped_file_max_tokens — a raw
        # file value above MAX-512 would drop ALL chat history). Defensive-only
        # now: _resolve_llm_gen_params always sets max_tokens on every request
        # that reaches here, so the `or` arm only covers direct callers.
        max_answer_tokens = llm_parameters_dict.get("max_tokens") or _clamped_file_max_tokens()
        # Count tokens in full prompt (system + user combined for token limit check)
        full_prompt_tokens = len(tokenizer.encode(system_instructions + user_content))
        # Check if the total token count exceeds the model's limit
        if full_prompt_tokens + max_answer_tokens > max_model_tokens - 200:  # Leave buffer
            # Calculate maximum tokens for history
            prompt_add_context_tokens = len(tokenizer.encode(prompt_add_context))
            translated_history_tokens = len(tokenizer.encode(translated_history_string))

            max_history_tokens = max(
                0,
                max_model_tokens
                + translated_history_tokens
                - max_answer_tokens
                - prompt_add_context_tokens
                - 200,
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
                f"{weather_section}"
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
        # G.3 (FR7): the anti-repetition decode params MUST reach vLLM. The old
        # key-pick stopped at max_tokens/top_p/stream/frequency_penalty/
        # temperature — repetition_penalty was defaulted in handle_request then
        # silently DROPPED at this boundary, and frequency_penalty defaults 0.0,
        # so no anti-loop param ever reached the model (10-01 "go tloga" x300).
        next_inputs["repetition_penalty"] = llm_parameters_dict["repetition_penalty"]
        if llm_parameters_dict.get("presence_penalty"):
            next_inputs["presence_penalty"] = llm_parameters_dict["presence_penalty"]
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
            # K.3: the pairing shape follows the search_start THIS request
            # actually used (the resolved retriever parms), not the boot env —
            # an admin's rag-tuning searchStart edit must not desync this
            # assert. Env fallback for paths that carry no parms.
            _parms = kwargs.get("retriever_parameters")
            _search_start = getattr(_parms, "search_start", None) or RETRIEVER_SEARCH_START
            if _search_start == "node" or _search_start == "edge":
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
            elif _search_start == "chunk":
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
                    f"{_search_start}. It should be one of "
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

            # K.2: file-driven abstention (per request) with the ONE shared
            # fallback text (the two sites used to diverge).
            _llm_cfg = _llm_settings()
            if str(_llm_cfg["enforceAbstention"]).lower() == "true":
                received_prompt += _llm_cfg["abstentionInstructions"] or _ABSTENTION_INSTRUCTIONS_DEFAULT

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

        # K.2: file-driven abstention (per request) with the ONE shared fallback
        # text. K.0: construction extracted to _build_rag_prompt so the degrade
        # path builds the byte-identical prompt from the same doc texts.
        next_data["inputs"] = _build_rag_prompt(initial_query, docs)

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
            next_data["text"] = data["choices"][0]["message"]["content"] if "choices" in data else "System Error: " + data.get("error", {}).get("message", "Unknown LLM Error")
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


# ==================== K.0: reranker-leg resilience (retry + degrade) ====================
# Live-found 10-05 (agriconnect.site): a transient CUDA OOM in the TEI reranker
# 500s; the reranker's text/plain error body then crashed the orchestrator's
# response.json() (ContentTypeError) -> chatqna 500 -> UI "chatqna returned
# 500". The reranker is an OPTIONAL quality stage: its failure may cost ranking
# quality on one request, never the answer. This execute wrapper gives the
# rerank leg ONE retry (~200ms backoff — ms-length OOM blips recover
# invisibly), then DEGRADES: the graph continues toward the LLM with the
# retriever docs already in hand and a loud WARN names the cause (plan.md:21).
# Only the rerank leg changes behavior — every other node passes straight
# through to the vendored ServiceOrchestrator.execute.

_RERANK_RETRY_BACKOFF_S = 0.2  # one retry, sub-second budget (K.0 spec)
# Per-attempt POST timeout — a hung reranker must not inherit the 1000s x2
# schedule-level budget (~33 min) before degrading.
_RERANK_ATTEMPT_TIMEOUT_S = 30
# Vendored-execute span parity: gate the rerank POST span exactly like comps'
# orchestrator does (TELEMETRY_ENDPOINT), so the healthy leg keeps its
# <node>_generate span. Deliberate mirror simplifications (internal rerank
# service only): no api_key_value/auth endpoint branch, no audio/wav branch.
_ORCHESTRATOR_SPANS_ENABLED = bool(os.environ.get("TELEMETRY_ENDPOINT"))


class _RerankerContractError(RuntimeError):
    """Deterministic reranker rejection (HTTP 4xx). A retry cannot fix it —
    degrade immediately and record it as a contract/regression signal, never
    as a transient."""


def _degrade_doc_score(doc):
    """Retriever-side relevance for degrade ordering: top-level "score" OR
    metadata.score (the retriever keeps similarity in metadata.score; the
    top-level key may be absent pre-rerank, which would make a plain
    doc.get("score", 0.0) sort a no-op). Unreadable -> 0.0; the stable sort
    keeps retriever order among equals."""
    score = doc.get("score")
    if score is None:
        score = (doc.get("metadata") or {}).get("score")
    try:
        return float(score)
    except (TypeError, ValueError):
        return 0.0


def _build_rag_prompt(initial_query, docs):
    """Shared RAG prompt/abstention assembly — used by BOTH the RERANK branch
    of align_outputs and the K.0 degrade path (K.2 dedup law: one construction
    site, no divergence).

    K.7b: docs FIRST, `QUESTION: {query}` LAST — the question sits adjacent to
    the "respond to the latest question" instruction instead of being buried
    at the head of the knowledge-base blob (kills the model's
    "Question: … / Answer:" preamble at the source). The query here is the
    (reformulated) retrieval query."""
    _llm_cfg = _llm_settings()
    if not docs and str(_llm_cfg["enforceAbstention"]).lower() == "true":
        # Same shape as below (one function, one shape): instructions first,
        # QUESTION line last.
        return (
            (_llm_cfg["abstentionInstructions"] or _ABSTENTION_INSTRUCTIONS_DEFAULT)
            + f"QUESTION: {initial_query}"
        )
    return (
        "".join(f"[Retrieved Document]: {doc}\n" for doc in docs)
        + f"QUESTION: {initial_query}"
    )


def _reranker_degraded_output(inputs, top_n):
    """Synthesize the rerank node's downstream output from the retriever docs
    already in hand (K.0 degrade). Carries the same keys the RERANK branch of
    align_outputs produces (the LLM leg and the citation/metadata legs consume
    them), but serves the retriever's OWN top-N by readable score — un-reranked
    docs, no fabricated reranker scores (grounding honesty: the healthy path
    serves top-N, so the degrade must not blow the prompt up to all ~20 docs).
    Guarded end-to-end: a raise here would resurrect the exact 500 class K.0
    kills."""
    retrieved_docs = inputs.get("retrieved_docs") or []
    if not isinstance(retrieved_docs, list):
        retrieved_docs = []
    try:
        selected = sorted(retrieved_docs, key=_degrade_doc_score, reverse=True)[:top_n]
        docs = [doc.get("text", "") for doc in selected]
        prompt = _build_rag_prompt(inputs.get("initial_query", " "), docs)
        # Keep degraded queries in the retrieval-quality eval dataset:
        # candidates = every retrieved doc, selected = the top-N actually
        # served (nothing was selected away by a reranker — by score order
        # only), scores = the readable retriever-side scores.
        _text_to_chunk_key = inputs.get("text_to_chunk_key") or {}
        if isinstance(_text_to_chunk_key, dict) and _text_to_chunk_key:
            _emit_reranker_selection_span(
                [_text_to_chunk_key.get(doc.get("text", ""), "N/A") for doc in retrieved_docs],
                [_text_to_chunk_key.get(doc.get("text", ""), "N/A") for doc in selected],
                [round(_degrade_doc_score(doc), 6) for doc in selected],
            )
    except Exception as synth_err:
        # Hardcoded fallback (no settings read): plain top-N slice of the
        # dict-shaped docs by whatever order they arrived in; empty-docs
        # prompt on total failure.
        logger.error(f"[K.0-RERANK-DEGRADED] scored synthesis failed ({synth_err!r}); raw fallback engaged")
        selected = [d for d in retrieved_docs if isinstance(d, dict) and isinstance(d.get("text"), str)][:top_n]
        docs = [d["text"] for d in selected]
        if docs:
            # K.7b: docs-first + QUESTION last, matching _build_rag_prompt.
            prompt = "".join(f"[Retrieved Document]: {d}\n" for d in docs) + f"QUESTION: {inputs.get('initial_query', ' ')}"
        else:
            prompt = inputs.get("initial_query", " ")
    degraded = {"inputs": prompt, "retrieved_docs": selected}
    if "file_id_pairs" in inputs:
        degraded["file_id_pairs"] = inputs["file_id_pairs"]
    return degraded


async def execute_with_reranker_resilience(
    self, session, req_start, cur_node, inputs, runtime_graph, llm_parameters=LLMParams(), **kwargs
):
    """K.0 wrapper around the vendored ServiceOrchestrator.execute (wired in
    ChatQnAService.__init__ alongside the align_* patches). The rerank leg
    gets retry-then-degrade (transient 5xx/connection class) or
    degrade-immediately (deterministic 4xx contract class); everything else
    is untouched."""
    service = (self.services or {}).get(cur_node)
    if service is None or service.service_type != ServiceType.RERANK:
        return await self._opea_execute(session, req_start, cur_node, inputs, runtime_graph, llm_parameters, **kwargs)

    llm_parameters_dict = llm_parameters.dict()
    # Same per-request source align_inputs uses (K.3): the resolved
    # reranker_parameters ride the schedule kwargs.
    top_n = getattr(kwargs.get("reranker_parameters"), "top_n", None) or RERANKER_TOP_N

    def _safe_degrade():
        try:
            return _reranker_degraded_output(inputs, top_n), cur_node
        except Exception as degrade_err:
            # Last-ditch: even the degrade synthesis must never re-raise.
            logger.error(f"[K.0-RERANK-DEGRADED] synthesis failed entirely ({degrade_err!r}); bare-query fallback")
            return {"inputs": inputs.get("initial_query", " "), "retrieved_docs": []}, cur_node

    last_error = None
    for attempt in (1, 2):
        try:
            # Mirrors the vendored non-streaming execute path (rerank is never
            # the LLM/VLM streaming leg): align -> POST -> decode -> align.
            # Deviation #1: a non-200 is an error HERE (before .json()) so the
            # error body reaches the WARN as a string instead of crashing the
            # decode (the 10-05 ContentTypeError class). Deviation #2: a tight
            # per-attempt timeout instead of the schedule-level 1000s.
            aligned = self.align_inputs(inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs)
            input_data = (
                aligned if isinstance(aligned, dict) else {k: v for k, v in aligned.dict().items() if v is not None}
            )
            endpoint = self.services[cur_node].endpoint_path(None)
            with (
                align_tracer.start_as_current_span(f"{cur_node}_generate")
                if _ORCHESTRATOR_SPANS_ENABLED
                else contextlib.nullcontext()
            ):
                response = await session.post(
                    endpoint,
                    json=input_data,
                    timeout=aiohttp.ClientTimeout(total=_RERANK_ATTEMPT_TIMEOUT_S),
                )
            if response.status != 200:
                body = await response.text()
                if 400 <= response.status < 500:
                    raise _RerankerContractError(f"reranker returned HTTP {response.status}: {body}")
                raise RuntimeError(f"reranker returned HTTP {response.status}: {body}")
            data = await response.json()
            if attempt == 2:
                logger.warning(
                    f"[K.0] reranker leg failed once and recovered on retry "
                    f"(backoff {_RERANK_RETRY_BACKOFF_S}s); answer is fully reranked. "
                    f"Transient cause: {last_error!r}"
                )
            return self.align_outputs(data, cur_node, inputs, runtime_graph, llm_parameters_dict, **kwargs), cur_node
        except _RerankerContractError as e:
            # Deterministic rejection: retrying cannot help, and a real
            # regression must not hide inside the transient WARN class.
            logger.error(
                f"[K.0-RERANK-CONTRACT] deterministic reranker rejection — NOT retrying "
                f"(this is a pipeline contract regression, not a transient); degrading. Cause: {e}"
            )
            return _safe_degrade()
        except Exception as e:
            last_error = e
            if attempt == 1:
                await asyncio.sleep(_RERANK_RETRY_BACKOFF_S)
            else:
                # Deviation #3: degrade instead of re-raising — the query
                # proceeds on the retriever docs already in hand.
                logger.warning(
                    f"[K.0-RERANK-DEGRADED] reranker leg failed after {attempt} attempts; "
                    f"DEGRADING to un-reranked retriever docs for this query "
                    f"(ranking quality only — the answer continues). Cause: {e!r}"
                )
                return _safe_degrade()


class ChatQnAService:
    def __init__(self, host="0.0.0.0", port=8888):
        self.host = host
        self.port = port
        ServiceOrchestrator.align_inputs = align_inputs
        ServiceOrchestrator.align_outputs = align_outputs
        ServiceOrchestrator.align_generator = align_generator
        # K.0: rerank-leg retry + degrade (same injection idiom as the align_*
        # patches above). Idempotence guard: __init__ may run again in-process;
        # re-wrapping would nest retries.
        if not getattr(ServiceOrchestrator, "_genieai_k0_execute_patched", False):
            ServiceOrchestrator._opea_execute = ServiceOrchestrator.execute
            ServiceOrchestrator.execute = execute_with_reranker_resilience
            ServiceOrchestrator._genieai_k0_execute_patched = True
        self.megaservice = ServiceOrchestrator()
        self.endpoint = str(MegaServiceEndpoint.CHAT_QNA)
        self.user_profile_client = GenieUserProfileClient()

    def _find_node_key(self, service_name: str, result_dict: dict) -> str | None:
        """Helper to find the full key for a service in the result_dict."""
        for key in result_dict:
            if key.startswith(service_name):
                return key
        return None

    # ==================== WEATHER RAG AUGMENTATION (Agrivisory) ====================
    _weather_cache = {}  # (lat, lon) -> (timestamp, formatted_string)
    _geocode_cache = {}  # place_name_lower -> (timestamp, {latitude, longitude})

    async def _geocode_location_from_query(self, query_text: str) -> dict | None:
        """Extract and geocode a location from the query via Nominatim (scoped to Lesotho)."""
        if not query_text:
            return None
        location_indicators = [
            "weather", "rain", "temperature", "forecast", "climate",
            "plant", "planting", "harvest", "irrigat", "spray",
            " in ", " at ", "near ", "around ", "for ",
        ]
        query_lower = query_text.lower()
        if not any(indicator in query_lower for indicator in location_indicators):
            return None

        location_patterns = [
            r'\b(?:in|at|near|around|for)\s+([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)*)',
            r'\b(?:weather|rain|forecast|temperature|climate)\s+(?:in|at|for|of)\s+([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)*)',
            r'\b([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z][a-zA-Z\'\-]+)*)\s+(?:weather|rain|forecast|temperature|climate)',
        ]
        candidate_locations = []
        for pattern in location_patterns:
            candidate_locations.extend(re.findall(pattern, query_text))
        if not candidate_locations:
            return None

        for candidate in candidate_locations:
            candidate_clean = candidate.strip().rstrip('?.!')
            if len(candidate_clean) < 3:
                continue
            cache_key = candidate_clean.lower()
            if cache_key in self._geocode_cache:
                return self._geocode_cache[cache_key][1]
            try:
                params = {
                    "q": candidate_clean, "countrycodes": "ls",
                    "format": "json", "limit": 1, "addressdetails": 0,
                }
                headers = {"User-Agent": "Agrivisory/2.0 (weather-rag-integration)"}
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        "https://nominatim.openstreetmap.org/search",
                        params=params, headers=headers,
                        timeout=aiohttp.ClientTimeout(total=3),
                    ) as response:
                        if response.status == 200:
                            results = await response.json()
                            if results:
                                coords = {"latitude": float(results[0]["lat"]), "longitude": float(results[0]["lon"])}
                                self._geocode_cache[cache_key] = (time.time(), coords)
                                if logflag:
                                    logger.info(f"[WEATHER-RAG] Geocoded '{candidate_clean}' -> ({coords['latitude']}, {coords['longitude']})")
                                return coords
                        else:
                            logger.warning(f"[WEATHER-RAG] Nominatim returned status {response.status}")
            except Exception as e:
                logger.warning(f"[WEATHER-RAG] Geocoding failed for '{candidate_clean}': {e}")
        return None

    async def _fetch_weather_context(self, location_data: dict = None, query_text: str = None) -> str:
        """Fetch weather from the backend weather service, formatted as compact LLM context.

        Location priority: geocoded from query > frontend weatherLocation > default (Maseru).
        In-memory cache with TTL. Returns "" on failure (non-critical).
        """
        if not WEATHER_AUGMENTATION_ENABLED:
            return ""
        try:
            geocoded_location = await self._geocode_location_from_query(query_text) if query_text else None
            latitude = WEATHER_DEFAULT_LATITUDE
            longitude = WEATHER_DEFAULT_LONGITUDE
            if geocoded_location:
                latitude = geocoded_location["latitude"]
                longitude = geocoded_location["longitude"]
            elif location_data:
                latitude = float(location_data.get("latitude", latitude))
                longitude = float(location_data.get("longitude", longitude))

            cache_key = (round(latitude, 2), round(longitude, 2))
            now = time.time()
            if cache_key in self._weather_cache:
                cached_time, cached_data = self._weather_cache[cache_key]
                if now - cached_time < WEATHER_CACHE_TTL_SECONDS:
                    return cached_data

            url = f"{BACKEND_SERVICE_URL}/api/weather"
            token = self.user_profile_client._token
            if not token:
                logger.warning("[WEATHER-RAG] No auth token available, skipping weather fetch")
                return ""
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            payload = {"latitude": latitude, "longitude": longitude}
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=payload, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        formatted = self._format_weather_context(data)
                        self._weather_cache[cache_key] = (now, formatted)
                        return formatted
                    logger.warning(f"[WEATHER-RAG] Backend returned status {response.status}")
                    return ""
        except Exception as e:
            logger.warning(f"[WEATHER-RAG] Weather fetch failed (non-critical): {e}")
            return ""

    def _format_weather_context(self, weather_data: dict) -> str:
        """Format weather API response into compact LLM context block."""
        location = weather_data.get("location", "Unknown")
        current = weather_data.get("current", {})
        forecast = weather_data.get("forecast", [])
        lines = [
            f"Location: {location}",
            f"Now: {current.get('temperature')}\u00b0C, {current.get('condition')}, "
            f"Humidity {current.get('humidity')}%, Wind {current.get('windSpeed')} km/h",
        ]
        for day in forecast[:7]:
            date_str = day.get("date", "")[:10]
            precip = day.get("precipitation")
            precip_str = f", Rain {precip}mm" if precip and precip > 0 else ""
            lines.append(
                f"{date_str}: {day.get('condition')}, "
                f"High {day.get('highTemp')}\u00b0C / Low {day.get('lowTemp')}\u00b0C{precip_str}"
            )
        return "\n".join(lines)
    # ==================== END WEATHER RAG AUGMENTATION ====================

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
                    # .get: a legacy row without a labels key must not KeyError the
                    # whole metadata event (I.4 hardening).
                    labels = file_metadata.get("labels", [])
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
            category_labels = (
                labels if isinstance(labels, list) else [labels] if labels else []
            )
            source_documents_formatted.append(
                {
                    "document_id": file_id,
                    "document_name": file_name,
                    "url": file_read_url,
                    # I.4: ALL consumers (web, mobile, history writer/reader) read the
                    # SINGULAR key; emit it alongside the plural for compatibility.
                    "categoryLabel": category_labels[0] if category_labels else None,
                    "categoryLabels": category_labels,
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

    async def _stream_with_metadata(self, body_iterator, result_dict, original_language=None):
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

        End-of-stream translation (F4, DEC-19 Sesotho primary): when
        ``original_language`` is set and not EN, the settled answer is translated
        through the same pipeline the non-streaming path (``_finalize_llm_response``)
        uses and emitted as a ``translated_answer`` event before the metadata — the
        browser replaces the live English preview with it. A translation failure
        NEVER fails the stream: the English answer stands and a
        ``translation_unavailable`` event is emitted instead — never silent, never
        the wrong language presented as a translation.

        Degeneration guard (G.4, FR1/FR8): a tail that repeats an n-gram
        consecutively is withheld from emission; once the repetition passes the
        confirm threshold the LLM stream is stopped, the loop tail dropped, and
        the metadata event carries ``degenerate_truncated: true`` — a loop is
        never yielded whole nor persisted as a cleanly answered query.
        """
        buffer = ""
        full_text = ""  # assembled (marker-stripped) answer for end-of-stream translation
        self_confidence = None  # LLM self-grade value, captured from the sentinel
        held = ""  # G.4: withheld tail — suspected (2nd+) repetitions of a looping n-gram
        degenerate = False  # G.4: a confirmed repetition loop was truncated
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
                # G.4 degeneration guard (FR1/FR8): scan the assembled answer for
                # a consecutive n-gram loop forming at its end. A suspected loop
                # (2nd repetition onward) is withheld, never yielded; once it
                # reaches the confirm threshold the LLM stream is stopped, the
                # loop tail dropped, and the answer marked truncated in the
                # metadata event — a loop is never yielded whole nor persisted
                # as a clean answer. Healthy text (lists, crop names) never
                # repeats one n-gram 6+ times consecutively; a legitimate 2x
                # repeat only delays its second copy until the pattern breaks.
                held += emit
                det = _scan_degeneration(full_text + held)
                if det is None:
                    out, held = held, ""
                else:
                    hold_char, confirmed = det
                    keep = max(hold_char - len(full_text), 0)
                    if confirmed:
                        out, held = held[:keep], ""
                        degenerate = True
                        logger.warning(
                            f"Degenerate repetition loop detected after {len(full_text) + len(out)} chars "
                            f"— stream truncated and marked (FR1/FR8)"
                        )
                    else:
                        out, held = held[:keep], held[keep:]
                if out:
                    full_text += out
                    yield f"data: {out.encode('utf-8')!r}\n\n"
                if degenerate:
                    # Close the upstream body iterator explicitly — abandoning
                    # it mid-iteration would leave the vLLM connection to GC.
                    if hasattr(body_iterator, "aclose"):
                        await body_iterator.aclose()
                    break

        # Flush whatever remains (final pass: a partial marker that never completed
        # is real content and must be emitted, not dropped). After a confirmed
        # degenerate loop nothing may be flushed — the loop tail stays trimmed.
        if held and not degenerate:
            # A legitimate repeated tail (below the confirm threshold) is real
            # content: release it now that the stream has ended.
            full_text += held
            yield f"data: {held.encode('utf-8')!r}\n\n"
            held = ""
        if buffer and not degenerate:
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
                full_text += buffer
                yield f"data: {buffer.encode('utf-8')!r}\n\n"

        # End-of-stream translation (F4): runs AFTER the last token so TTFT is
        # unaffected. Same EN short-circuit as _finalize_llm_response (exact "EN"
        # match) — English/unset requests keep byte-identical streaming behavior.
        if original_language and original_language.strip() != "EN" and full_text.strip():
            language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)
            target_lang_name = language_codes.get(original_language.lower(), original_language)
            try:
                translated = await self._translate_with_chunking(
                    full_text, target_lang_name, original_language, raise_on_error=True
                )
                if logflag:
                    logger.info(
                        f"Streaming translation to {target_lang_name} completed "
                        f"({len(full_text)} chars in, {len(translated)} chars out)"
                    )
                yield "data: " + json.dumps({"type": "translated_answer", "text": translated}) + "\n\n"
            except Exception as e:
                # Never an error, never silence: the streamed English answer stands
                # and the client shows the unavailable notice.
                logger.error(f"Streaming translation to {target_lang_name} failed — answer stays in English: {e}")
                yield "data: " + json.dumps({"type": "translation_unavailable"}) + "\n\n"

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
        if degenerate:
            # G.4 (FR8): this answer was cut at a confirmed repetition loop —
            # persisted with the record so a loop is never stored as a cleanly
            # answered query. Absent on healthy streams (byte-identical event).
            metadata["degenerate_truncated"] = True
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

        # F6: NLLB history routes through _translate_text_chunk — the single
        # sidecar call site (direction: source=user lang → English). A sidecar
        # failure inside it returns the original blob, same contract as below.
        if _is_nllb():
            return await self._translate_text_chunk(
                flattened_history_string, target_language, iso_code="en",
                source_lang_code=source_lang_code,
            )

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
                    headers=_translation_auth_headers(),
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

    # J.1: the old _split_text_into_chunks (sentence-boundary chunker) is
    # DELETED — it flattened markdown structure and its caller rejoined
    # chunks with " ", which is how the ST answer lost every paragraph break.

    async def _translate_text_chunk(
        self,
        text: str,
        target_lang: str,
        iso_code: str = None,
        source_lang_code: str = "en",
        raise_on_error: bool = False,
    ) -> str:
        """Translate a single chunk of text.

        Automatically uses TranslateGemma completions API (with pre-formatted prompt)
        or generic chat completions format based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            text: Text to translate.
            target_lang: Target language name (e.g. "Sesotho").
            iso_code: Target ISO language code (e.g. "st").
            source_lang_code: Source ISO language code (e.g. "en"). Defaults to "en".
            raise_on_error: Re-raise instead of returning the original text. The
                streaming end-of-stream translation must distinguish "translation
                failed" (→ translation_unavailable notice) from a real translated
                answer; silently returning English there would present the wrong
                language as a translation (F4).
        """
        # Payload building lives INSIDE the try: _nllb_flores_code raises on an
        # unknown ISO (F4 law — never a wrong-language default) and that failure
        # must ride the SAME raise_on_error/original-text contract as a dead
        # sidecar, not bypass it.
        try:
            if _is_nllb():
                # Sidecar speaks FLORES-200 natively: {texts, source, target} →
                # {translations}. No chat prompt — NLLB is not an LLM (F6).
                payload = {
                    "texts": [text],
                    "source": _nllb_flores_code(source_lang_code),
                    "target": _nllb_flores_code(iso_code or "en"),
                }
                url = f"{NLLB_TRANSLATE_URL}/translate"
            elif _is_translategemma():
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
                svc = "NLLB" if _is_nllb() else ("TranslateGemma" if _is_translategemma() else "generic")
                logger.debug(f"Translation payload ({svc}): {payload}")

            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers=_translation_auth_headers(),
                )
                response.raise_for_status()
                response_data = response.json()
                if _is_nllb():
                    return response_data["translations"][0].strip()
                elif _is_translategemma():
                    return response_data["choices"][0]["text"].strip()
                else:
                    return response_data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            if raise_on_error:
                raise
            logger.warning(f"Failed to translate chunk, returning original: {type(e).__name__}: {e}")
            return text

    async def _translate_texts_batch(
        self,
        texts: list[str],
        target_lang: str,
        iso_code: str = None,
        source_lang_code: str = "en",
        raise_on_error: bool = False,
    ) -> list[str]:
        """Translate short segments in ONE sidecar request (NLLB batch
        contract: ``{texts}`` → 1:1 ``{translations}``), or concurrently per
        segment on the other backends. Failure semantics match
        ``_translate_text_chunk``: raise when ``raise_on_error``, originals
        otherwise (J.1 — extracted so the answer path can batch lines)."""
        if _is_nllb():
            try:
                payload = {
                    "texts": texts,
                    "source": _nllb_flores_code(source_lang_code),
                    "target": _nllb_flores_code(iso_code or "en"),
                }
                async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                    response = await client.post(
                        f"{NLLB_TRANSLATE_URL}/translate",
                        json=payload,
                        headers=_translation_auth_headers(),
                    )
                    response.raise_for_status()
                    translations = response.json()["translations"]
                if len(translations) != len(texts):
                    raise ValueError(
                        f"sidecar returned {len(translations)} translations for {len(texts)} texts"
                    )
                # An EMPTY translation for non-empty input would silently
                # drop the span (adjacent markers, missing words) — keep the
                # original instead (J.1 review).
                return [
                    t.strip() if t.strip() else orig for t, orig in zip(translations, texts)
                ]
            except Exception as e:
                if raise_on_error:
                    raise
                logger.warning(
                    f"Failed to translate batch, returning originals: {type(e).__name__}: {e}"
                )
                return list(texts)
        return list(
            await asyncio.gather(
                *[
                    self._translate_text_chunk(
                        t, target_lang, iso_code,
                        source_lang_code=source_lang_code, raise_on_error=raise_on_error,
                    )
                    for t in texts
                ]
            )
        )

    async def _translate_with_chunking(
        self,
        text: str,
        target_lang: str,
        iso_code: str = None,
        source_lang_code: str = "en",
        raise_on_error: bool = False,
    ) -> str:
        """J.1 structure-preserving translation of the settled answer.

        The old implementation flattened the text
        (``replace("\\n\\n", "\\n").split(". ")``), rejoined chunks with
        ``" "``, and fed the ``**`` markers to NLLB — the ST answer arrived
        as one paragraph with spaced asterisks. Now: the text is split into
        LINES; each line's markdown prefix and inline markers are kept
        verbatim; only the readable spans are batched to the sidecar
        (≤64 texts / 2000 chars per request, concurrently); the lines are
        reassembled with the original newlines.
        """
        line_segments = [
            _split_line_translation_segments(line) if line.strip() else None
            for line in text.split("\n")
        ]

        if _is_nllb():
            # Segment-granular batching: markers never reach the tokenizer.
            jobs: list[tuple[int, int, list[str]]] = []  # (line, segment, pieces)
            for li, segments in enumerate(line_segments):
                if segments is None:
                    continue
                for si, (seg_text, translatable) in enumerate(segments):
                    if translatable and _is_translatable_text(seg_text):
                        # J.1 review: a single segment may exceed the sidecar's
                        # per-text cap — split it so one long paragraph can't
                        # 400 the whole batch (and kill the streamed ST answer).
                        pieces = _split_overlong_segment(seg_text)
                        jobs.append((li, si, pieces))

            if logflag:
                logger.info(
                    f"Translating {len(text)} chars / {len(jobs)} segments "
                    f"to {target_lang}"
                )

            translated: dict[tuple[int, int], str] = {}
            if jobs:
                flat: list[tuple[int, int, str]] = [
                    (li, si, piece) for li, si, pieces in jobs for piece in pieces
                ]
                batches: list[list[tuple[int, int, str]]] = []
                current: list[tuple[int, int, str]] = []
                chars = 0
                for job in flat:
                    if current and (len(current) >= 64 or chars + len(job[2]) > 2000):
                        batches.append(current)
                        current, chars = [], 0
                    current.append(job)
                    chars += len(job[2])
                if current:
                    batches.append(current)

                # J.1 review: bound concurrent batches — each is a 64-text
                # beam-4 generate() on a GPU shared with vLLM/TEI; the
                # sidecar's 64-text cap exists to keep the card from OOM.
                sem = asyncio.Semaphore(2)

                async def run_batch(batch):
                    async with sem:
                        return await self._translate_texts_batch(
                            [j[2] for j in batch],
                            target_lang, iso_code,
                            source_lang_code=source_lang_code,
                            raise_on_error=raise_on_error,
                        )

                results = await asyncio.gather(*[run_batch(b) for b in batches])
                # Piece translations rejoin with spaces INSIDE their segment
                # (only over-long segments ever have >1 piece).
                by_segment: dict[tuple[int, int], list[str]] = {}
                for batch, outs in zip(batches, results):
                    for job, out in zip(batch, outs):
                        by_segment.setdefault((job[0], job[1]), []).append(out)
                translated = {k: " ".join(v) for k, v in by_segment.items()}
        else:
            # Non-NLLB backends are instruction LLMs: one request per LINE
            # (segments rejoined) — marker protection is an NLLB-tokenizer
            # concern, and per-segment calls would explode request count
            # (J.1 review; matches the old whole-chunk behavior, line-granular).
            lines_idx = [
                li for li, segments in enumerate(line_segments) if segments is not None
            ]
            line_texts = [
                "".join(seg for seg, _ in line_segments[li]) for li in lines_idx
            ]
            worth = [
                (li, t) for li, t in zip(lines_idx, line_texts)
                if _is_translatable_text(t)
            ]
            if logflag:
                logger.info(
                    f"Translating {len(text)} chars / {len(worth)} lines "
                    f"to {target_lang} (non-NLLB backend)"
                )
            translated = {}
            if worth:
                outs = await asyncio.gather(
                    *[
                        self._translate_text_chunk(
                            t, target_lang, iso_code,
                            source_lang_code=source_lang_code,
                            raise_on_error=raise_on_error,
                        )
                        for _, t in worth
                    ]
                )
                translated = {(li, -1): out for (li, _), out in zip(worth, outs)}

        lines_out = []
        for li, segments in enumerate(line_segments):
            if segments is None:
                lines_out.append("")
                continue
            whole = translated.get((li, -1))  # non-NLLB: one translation per line
            if whole is not None:
                lines_out.append(whole)
            else:
                lines_out.append(
                    "".join(
                        translated.get((li, si), seg_text)
                        for si, (seg_text, _) in enumerate(segments)
                    )
                )
        return "\n".join(lines_out)

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
                # I.4 review F2: a plain dict serializes as HTTP 200 — the rejection
                # was invisible (empty answers, no non-200 log). A real 401 surfaces
                # in backend logs AND the frontend error path.
                logger.warning("Incoming Bearer token failed JWKS validation — rejecting request")
                return JSONResponse(status_code=401, content={"error": "Unauthorized", "message": "Token validation failed"})

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

        # K.7b conversational query reformulation: with history, rewrite the
        # follow-up into a self-contained query BEFORE retrieval so BOTH
        # retrieval legs (dense + BM25) and the KB question line carry the
        # resolved subject. The rewritten query replaces ONLY the retrieval
        # text — history, UI, weather parsing and analytics keep the user's
        # original text. First turn / kill-switch off / rewriter failure all
        # degrade to the raw query (K.7 behavior).
        retrieval_query = last_translated_message_content
        query_reformulated = False
        if QUERY_REFORMULATION_ENABLED:
            _rewritten = await _reformulate_query(last_translated_message_content, translated_history_string)
            if _rewritten:
                retrieval_query = _rewritten
                query_reformulated = True
                if logflag:
                    logger.info(
                        f"[K.7b] Reformulated retrieval query: {_rewritten!r} "
                        f"(raw follow-up: {last_translated_message_content!r})"
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

        # K.2: request-explicit > settings file > coded defaults (see
        # _resolve_llm_gen_params — the falsy-zero fix).
        llm_kwargs = _resolve_llm_gen_params(chat_request)
        # max_tokens resolves inside _resolve_llm_gen_params (request-explicit
        # else the file's clamped generation.maxTokens — see
        # _clamped_file_max_tokens). Always an int, so the old
        # Pydantic->=2.13 None-rejection concern no longer applies.
        if chat_request.chat_template:
            llm_kwargs["chat_template"] = chat_request.chat_template
        if chat_request.model:
            llm_kwargs["model"] = chat_request.model
        parameters = LLMParams(**llm_kwargs)
        # K.3: request-explicit > settings file > coded defaults — the RAG
        # tuning resolution (see _resolve_rag_parms).
        _retriever_kwargs, _reranker_kwargs = _resolve_rag_parms(chat_request)
        retriever_parameters = GenieaiRetrieverParms(**_retriever_kwargs)

        reranker_parameters = GenieaiRerankerParms(**_reranker_kwargs)

        # Agrivisory: weather-aware RAG
        weather_location = None
        if chat_request.context and getattr(chat_request.context, "weatherLocation", None):
            weather_location = chat_request.context.weatherLocation
        weather_context = await self._fetch_weather_context(weather_location, query_text=last_translated_message_content)

        # RAG orchestration with tracing span
        tracer = get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            span.set_attribute("rag.query_length", len(last_translated_message_content))
            # K.7b observability: whether retrieval ran on a rewritten query.
            span.set_attribute("rag.query_reformulated", str(query_reformulated).lower())
            span.set_attribute("rag.model_id", _get_llm_model())

            _rag_start = time.time()
            try:
                result_dict, runtime_graph = await self.megaservice.schedule(
                    initial_inputs={
                        # K.7b: the (possibly reformulated) self-contained query
                        # drives embedding + BM25 + the KB question line.
                        "text": retrieval_query,
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
                    weather_context=weather_context,
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
                # original_language flows through so the F4 end-of-stream translation
                # (translated_answer / translation_unavailable events) runs for
                # non-English requests — the streaming path previously never translated.
                return StreamingResponse(
                    self._stream_with_metadata(response.body_iterator, result_dict, original_language),
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
