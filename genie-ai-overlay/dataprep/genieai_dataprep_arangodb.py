# Copyright (C) 2025 International Telecommunication Union (ITU)
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import contextvars

try:
    import fcntl  # POSIX file locking — the service runs in a Linux container
except ModuleNotFoundError:  # Windows dev checkout: locking degrades to a no-op
    fcntl = None  # type: ignore[assignment]
import json
import os
import re
import threading
import time
from contextlib import suppress
from typing import Any

import aiohttp
from opentelemetry import propagate

from core.model_cache import MAX_SANE_MODEL_WINDOW_TOKENS, get_max_model_len, get_model_id, resolve_model_id
from core.model_http_policy import (
    AIOHTTP_CONNECT_TIMEOUT_SECONDS,
    CONTROL_PLANE_TIMEOUT_SECONDS,
    LLM_MAX_RETRIES,
    LLM_TIMEOUT_SECONDS,
    http_timeout,
    positive_float_env,
)
from core.span_attrs import ATTRIBUTE_NAMES
from tracing import (
    background_span,
    get_meter,
    get_tracer,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
    with_span,
)

tracer = get_tracer(__name__)


# --- vLLM context-overflow fail-loud contract (LABELING ONLY) ---
# Mirrors the reranker fix (RerankerInputTooLongError, genieai_tei_reranker.py:39): when
# vLLM rejects a LABELING request because the prompt exceeds the model's max_model_len,
# the call site raises this typed exception instead of silently swallowing the error.
# Counter + OTel span attribute surface this to operators.
#
# The CONTEXT-GENERATION call sites deliberately do NOT raise: contextualization is
# optional enrichment and its documented contract is "never blocks ingestion (raw-chunk
# fallback)" — they log to _write_ingestion_log, count the metric, and degrade to
# per-chunk calls / raw chunks (Bali regression 2026-10-16, see _context_batch_call).
class DataprepInputTooLongError(RuntimeError):
    """Raised when a vLLM labeling call exceeds the model's context window.

    vLLM returns BadRequestError("This model's maximum context length is N tokens...
    Please reduce the length...") when the prompt + reserved output exceeds the
    configured max_model_len. This typed exception lets the async-fire-and-forget
    ingest task record the failure through `_write_ingestion_log` (admin UI surface
    per .claude/rules/DEBUGGING-TRACING.md §6.1) rather than silently ingesting a
    degraded chunk.
    """


# Markers in vLLM/OpenAI error messages that indicate context-overflow. Classified by
# string-substring rather than SDK exception type to avoid lock-in on a specific
# `openai` SDK version (test envs + minimal docker images may not ship the SDK).
#
# "string too long" was REMOVED (reviewer note): it also fires for non-overflow
# errors like `messages[2].tool_calls[0].id: string too long` and oversized
# `tools[0].function.description` (>1 MB). The remaining 5 markers cover the
# canonical vLLM granite-4.1-8b context-overflow message body.
_VLLM_CONTEXT_OVERFLOW_MARKERS = (
    "context length",
    "context_length_exceeded",
    "maximum context length",
    "reduce the length",
    "context window",
)


def _overflow_message_from_exc(exc: BaseException) -> str:
    """Aggregate every string-shaped field of an exception into one lowercased haystack.

    Production SDKs put the vLLM error body in different places depending on the
    transport:
      - openai.BadRequestError (>=3.x): body is on `exc.body['error']['message']`
        (dict) or on `exc.response.text` (string); `str(exc)` is ONLY the status
        code phrase (`"Error code: 400"`) — body NOT included.
      - httpx.HTTPStatusError: body is on `exc.response.text`; `str(exc)` is
        `'Client error '400 Bad Request' for url '...'` — no body.
      - aiohttp.ClientResponseError: body is on `exc.message`.
      - bare Exception/ValueError (test mocks + legacy code): the marker phrase
        lives in `str(exc)`.

    Union ALL of these so the classifier matches the LIVE shape, not just the
    shape that happens to be used in unit tests.
    """
    parts: list[str] = []
    with suppress(Exception):
        parts.append(str(exc) or "")
    try:
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                msg = err.get("message") or err.get("detail") or ""
                if msg:
                    parts.append(str(msg))
        elif isinstance(body, str):
            parts.append(body)
    except Exception:
        pass
    try:
        resp = getattr(exc, "response", None)
        if resp is not None:
            text = getattr(resp, "text", None)
            if text:
                parts.append(str(text))
    except Exception:
        pass
    try:
        msg = getattr(exc, "message", None)
        if msg and isinstance(msg, str):
            parts.append(msg)
    except Exception:
        pass
    return " ".join(parts).lower()


# Class-name fragments of the timeout exceptions the model-endpoint clients
# raise: openai's APITimeoutError (its own class plus the httpx one it wraps),
# httpx's TimeoutException, and aiohttp's ServerTimeoutError / asyncio's
# TimeoutError. Matched on the class name rather than by importing the
# libraries, so the classifier keeps working when one of them is absent — the
# same reason _is_vllm_input_overflow inspects the message instead.
_TIMEOUT_CLASS_MARKERS = ("Timeout",)


def _is_timeout(exc: BaseException) -> bool:
    """True if `exc` is a request timeout rather than any other failure.

    Worth separating from the generic handler because it is the failure the
    HTTP budget produces on purpose: a timeout means the model endpoint did not
    answer within its allowance, which points at GPU contention and at a budget
    that may need raising. A 500 or a JSON parse failure means something else
    entirely, and conflating the two makes a saturated GPU look like a broken
    prompt.

    Walks the ``__cause__`` chain so a timeout wrapped by a client-specific
    wrapper is still recognised.
    """
    seen = 0
    cur: BaseException | None = exc
    while cur is not None and seen < 10:
        name = type(cur).__name__
        if any(marker in name for marker in _TIMEOUT_CLASS_MARKERS):
            return True
        cur = cur.__cause__ or cur.__context__
        seen += 1
    return False


def _is_vllm_input_overflow(exc: BaseException) -> bool:
    """True if `exc` represents a vLLM context-length rejection; False otherwise.

    Generous matcher: any text-shaped surface of the exception (str(), openai
    body dict, httpx response body, aiohttp message) containing one of the
    well-known vLLM/OpenAI context-overflow markers classifies as overflow.
    Generic `Exception` injections in tests still work because the test
    message contains the marker verbatim.
    """
    haystack = _overflow_message_from_exc(exc)
    if not haystack:
        return False
    return any(marker in haystack for marker in _VLLM_CONTEXT_OVERFLOW_MARKERS)


_dataprep_input_too_long_total = get_meter().create_counter(
    "rag.dataprep.input_too_long",
    description=(
        "Dataprep vLLM calls rejected because the prompt exceeded the model's "
        "max_model_len. Incremented instead of the generic error counter; surfaces "
        "silent-truncation regressions before they cascade into user-visible failure."
    ),
)

# Degradation counters. Every LLM phase here has a fallback that produces a
# usable document without the model, which is a feature for availability and a
# trap for observability: a document can end up labeled entirely from file
# labels while every log line looks like a success. These counters are the only
# way to see the degradation happen, since the fallback is a normal return path.
_meter = get_meter()

_dataprep_phase_budget_exhausted_total = _meter.create_counter(
    "rag.dataprep.phase_budget_exhausted",
    description=(
        "LLM phases abandoned because they exceeded DATAPREP_LLM_PHASE_TIMEOUT_SECONDS. "
        "The ingest continued on the phase's fallback, so this counts degraded "
        "documents, not failed ones. A non-zero rate on a healthy GPU means the "
        "per-request budget is too tight for the phase, not that the GPU is busy."
    ),
)

_llm_fallback_total = _meter.create_counter(
    "rag.dataprep.llm_fallback",
    description=(
        "LLM labeling/context batches that fell back to a cheaper path (per-chunk "
        "call, file labels, or raw chunk). Counts degradation events across both "
        "the per-batch and whole-phase paths, which the ingestion log alone cannot "
        "distinguish from ordinary progress. Correlates with phase_budget_exhausted "
        "via the same 'phase' label — both use PHASE_LABEL_*."
    ),
)

# Metric label vocabulary. Both counters stamp these slugs, so a query joining
# "how often did a phase blow its budget" to "how many batches fell back"
# correlates on one value set. The human-readable stage name that goes into the
# ingestion log is a separate argument — an operator-facing string has no
# business being a metrics dimension, and a display name reused as a label
# splits the join the moment one of them is reworded.
PHASE_LABEL_LABELING = "labeling"
PHASE_LABEL_CONTEXTUAL = "contextual"

# Import exceptions for robust error handling
# Import Parent Class
import comps.dataprep.src.integrations.arangodb as _parent_mod
from arango.exceptions import AQLQueryExecuteError

# Import OPEA Core
from comps import CustomLogger, DocPath, OpeaComponentRegistry

# Import Custom GENIE Protocols
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo

# Import Custom Utils
from comps.dataprep.src.genieai_dataprep_utils import docling_document_loader, document_loader, is_valid_content
from comps.dataprep.src.integrations.arangodb import OpeaArangoDataprep
from comps.dataprep.src.utils import get_separators
from fastapi import HTTPException
from langchain_arangodb import ArangoGraph
from langchain_core.documents import Document
from langchain_text_splitters import (
    HTMLHeaderTextSplitter,
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)
from numpy import dot
from numpy.linalg import norm
from openai import AsyncOpenAI
from pydantic import ValidationError  # Import Pydantic validation error
from rank_bm25 import BM25Okapi

logger = CustomLogger("GENIE_DATAPREP_ARANGODB")


def _env_int(name: str, default: int) -> int:
    """Parse an int env var tolerantly: unset, empty (compose's default
    injection) or non-numeric all fall back to the default instead of
    crash-looping the service at import."""
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


def _sanitize_output_tokens(value: int, default: int) -> int:
    """Return a usable output-token reservation.

    0 or a negative value is not a reservation: it inflates the derived
    budget (the reservation is subtracted) AND reaches the API as
    ``max_tokens``, which it rejects. An absurd value would reserve more
    than any window holds. Both fall back to the default, loudly.
    """
    if value <= 0:
        logger.warning(
            f"DATAPREP_CONTEXTUAL_MAX_TOKENS={value} is not an output reservation — using the default "
            f"({default}); the request would carry an invalid max_tokens."
        )
        return default
    if value > 32768:
        logger.warning(
            f"DATAPREP_CONTEXTUAL_MAX_TOKENS={value} exceeds any context window — using the default ({default})."
        )
        return default
    return value


def _sanitize_window_override(value: int) -> int:
    """Return a usable window size, or 0 for "unset".

    A negative value is not a window (it would silently disable the
    override) and an absurd one exceeds every real model — a budget sized
    for it overflows every window and the calls fall back to raw chunks
    silently. Both are corrected here, loudly: the operator learns their
    setting was not what they wrote.
    """
    if value < 0:
        logger.warning(
            f"DATAPREP_MAX_MODEL_LEN={value} is not a window size — treating it as unset (the served "
            f"window is discovered at runtime instead)."
        )
        return 0
    if value > MAX_SANE_MODEL_WINDOW_TOKENS:
        # Clamping to "the largest sane window" is not a guard: 10 million
        # tokens still overflows every real model, silently. An absurd value
        # is treated as UNSET, so discovery answers instead.
        logger.warning(
            f"DATAPREP_MAX_MODEL_LEN={value} exceeds the largest sane context window "
            f"({MAX_SANE_MODEL_WINDOW_TOKENS}) — treating it as unset, so the served window is "
            f"discovered instead; a budget sized for {value} would overflow every real window."
        )
        return 0
    return value


setup_trace_logging("GENIE_DATAPREP_ARANGODB")
setup_json_logging("GENIE_DATAPREP_ARANGODB")
install_uvicorn_access_logging()
logflag = os.getenv("LOGFLAG", "false").lower() == "true"

# --- GENIE-Specific Configuration ---
# 1. Document Repository: Handles Logs and Status Updates
DOCUMENT_REPOSITORY_URL = os.getenv("DOCUMENT_REPOSITORY_URL", "http://document-repository:3001")
# 2. Backend Service: Source of Truth for Label Hierarchy
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")
# 3. OKF Server: the control plane that owns per-concept index status (Story
#    4.8-amend — content-only chunking routes the concept completion callback
#    here instead of the doc-repo, which holds no files doc for a concept).
OKF_SERVER_URL = os.getenv("OKF_SERVER_URL", "http://okf-server:3002")

# 3. Keycloak Service Account for OIDC authentication
from keycloak_service_account import get_service_account_token

GUARDRAIL_URL = os.getenv("GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails")
GUARDRAIL_ENABLED = os.getenv("GUARDRAIL_ENABLED", "false").lower() == "true"

# Spec 8.0: New Env Vars
LABELING_STRATEGY = os.getenv("LABELING_STRATEGY", "llm")
EMBEDDING_LABEL_THRESHOLD = float(os.getenv("EMBEDDING_LABEL_THRESHOLD", "0.75"))
BM25_LABEL_THRESHOLD = float(os.getenv("BM25_LABEL_THRESHOLD", "2.00"))
CONTENT_EXTRACTION_METHOD = os.getenv("CONTENT_EXTRACTION_METHOD", "opea")
LOCK_FILE_PATH = "/tmp/genie_dataprep.lock"
# PARALLEL INGEST (David, 2026-09-03: "repositories are independent units of
# work ... MUST run in parallel and utilize the machine resources"). Number of
# concurrently accepted ingest requests per dataprep container. Each slot is
# one flock file (the microservice 429s only when ALL slots are busy); the
# default 1 reproduces the historical single-flight exactly. The heavy stages
# are HTTP waits (vLLM labeling / TEI embedding — both natively concurrent),
# so in-process slots scale near-linearly until CPU-bound chunking dominates;
# scale further with container replicas on many-core nodes.
DATAPREP_INGEST_CONCURRENCY = max(1, int(os.getenv("DATAPREP_INGEST_CONCURRENCY", "1")))

# Request-local ingest context (parallel-ingest companion): each
# ingest_file_with_guardrail task binds its own {input, repo_id, caches} so
# concurrent requests no longer share the per-run state that used to live on
# `self` (under >1 slot, two ingests would clobber each other's bundle-log
# mirror and callback repo_id). ContextVars are asyncio-task-local: every
# request runs in its own task, so isolation is automatic. Helpers read the
# context first and FALL BACK to the legacy self attributes so the pytest
# fixtures (which set self._current_* directly) stay green.
_INGEST_CTX: contextvars.ContextVar = contextvars.ContextVar("ingest_ctx", default=None)
# Concurrency control for LLM labeling. Default raised 5 → 20 so vLLM's
# continuous batching is utilized — LLM labeling was the #1 ingestion
# bottleneck (~70% of wall time; see perf analysis on release/el-salvador).
# Tunable via env.
MAX_CONCURRENT_BATCHES = int(os.getenv("DATAPREP_MAX_CONCURRENT_BATCHES", "20"))

# Module-global vLLM batch gate, shared by every ingest task (review 2026-10-15).
# The per-task `asyncio.Semaphore(MAX_CONCURRENT_BATCHES)` this replaces capped
# each CONCEPT independently, so N concurrent ingests presented N x the cap to
# the shared GPU — measured 12 lanes x 20 = up to 240 concurrent calls, inflating
# per-call latency 3-15x and making added concurrency buy queueing, not
# throughput. One module-level gate makes DATAPREP_MAX_CONCURRENT_BATCHES the
# fleet-wide cap it reads as. Created lazily so env overrides still apply.
_BATCH_GATE: asyncio.Semaphore | None = None


def _global_batch_gate() -> asyncio.Semaphore:
    global _BATCH_GATE
    if _BATCH_GATE is None:
        _BATCH_GATE = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
    return _BATCH_GATE


# Number of chunks sent per LLM labeling call. >1 batches chunks into a single
# call to cut network round-trips to a (often remote) vLLM. Default 4 balances
# throughput (4x fewer calls) with compatibility across models; raise to 8 on
# capable models validated for batched JSON (e.g. granite-4.1-8b). Batches that
# fail to parse fall back to per-chunk labeling, so output is always correct.
LABEL_LLM_BATCH_SIZE = max(1, int(os.getenv("DATAPREP_LLM_LABEL_BATCH_SIZE", "4")))
# Sampling temperature for LLM labeling. 0.0 = greedy → deterministic, maximal
# format adherence (clean JSON) for a classification task; correct default for
# every instruction model. Tunable per model if ever needed.
LLM_LABEL_TEMPERATURE = float(os.getenv("DATAPREP_LLM_TEMPERATURE", "0.0"))

# OKF ACL label prefixes — access-control tokens (t:<tenant>, r:<repo_id>,
# d:<domain>) that ride on file_labels and must be preserved verbatim into
# chunk_labels so the retriever can enforce per-tenant/repo/domain isolation
# (OKF gap G4, Story 2.6a). A tuple (not frozenset) so str.startswith accepts
# it. Case-sensitive by design — pins the canonicalization boundary: the
# orchestrator (Story 2.9.1) must emit lowercase prefixes, and the retriever
# matches by exact membership (no normalization on either side).
_ACL_LABEL_PREFIXES = ("t:", "r:", "d:")


def _is_acl_label(label: Any) -> bool:
    """True iff ``label`` is an ACL-prefixed access-control token (t:/r:/d:).

    ACL tokens are enforcement labels, NOT taxonomy entries: they are never
    taxonomy-resolved, scoped, or proposed for the Knowledge Hierarchy — only
    propagated verbatim into chunk_labels.
    """
    return isinstance(label, str) and label.startswith(_ACL_LABEL_PREFIXES)


# --- Phase budgets -------------------------------------------------------
#
# The per-request budget (core/model_http_policy.py) bounds one HTTP call. This
# bounds the *phase* — every batch of that phase together. Both are needed:
# a phase with no bound is what turns a slow GPU into an unbounded stall, since
# a batch that fails only frees its slot after its own retry ladder finishes.
#
# A phase that exhausts its budget does not fail the ingest. Labeling degrades
# to file labels and Contextual Retrieval degrades to the raw chunk, which is
# exactly what a single batch failure already does — the phase bound only
# decides how long the document waits before taking the same path.
#
# Sized against what one *batch task* can occupy, because the unit the phase
# cancels is `_llm_suggest_labels` / the contextual equivalent, not an HTTP call.
# That task holds its semaphore slot across the batched call AND the per-chunk
# fallback it performs itself, so the ladder composes rather than picking one:
#
#   one batched HTTP call  (1 + LLM_MAX_RETRIES) x 180 =  540 s   no overlay loop
#   one per-chunk call      3 x (1 + LLM_MAX_RETRIES) x 180 = 1620 s  3 attempts
#   one batch task          540 + LABEL_LLM_BATCH_SIZE x 1620 = 7020 s at defaults
#   one WAVE of the document 4 x 180 = 720 s  — the reference 260-chunk document
#                                   runs 65 batches at concurrency 20
#
# The ceiling is spent over WAVES, not over one batch, and that is the
# arithmetic that actually binds. A 260-chunk document is 65 batches at
# concurrency 20 = 4 sequential waves, so even with every call inside its own
# budget the phase needs 4 x 180 = 720 s. A 600 s ceiling put the break-even
# per-call latency at 150 s — inside the 180 s budget — so a shared GPU
# answering a batched call in 160 s would degrade EVERY such document to file
# labels, permanently, while each individual call was well within its budget.
# That is the topology this MR exists for, so 900 s is the default. It is not
# four waves of EXHAUSTED ladders — those cost (1 + 2) x 180 = 540 s each, so
# 900 s absorbs about one and two thirds. What it clears is four waves of calls
# that each sit at their full per-request budget, which is the case that
# degrades a document whose calls all technically succeeded. A call that
# genuinely exhausts its ladder still gets cut, and that is the signal the bound
# is for.
#
# It remains roughly an eighth of one batch task (7020 s at the defaults), so
# no per-request budget can stop a runaway batch task — which is why the phase
# bound exists at all: it fires while a straggler is still inside its own
# ladder, so the document degrades at 900 s instead of at an unbounded time.
#
# It is a whole-phase ceiling, not a per-wave allowance: a 260-chunk document
# runs 65 batches in 4 waves of MAX_CONCURRENT_BATCHES, and all of them plus the
# queueing share the 900 s. A document large enough that its labelling would
# legitimately take longer is degraded — the phase does not scale its budget
# with the batch count. That is a deliberate ceiling, not an oversight: an
# unbounded budget is what produced the stall this replaces, and the
# degradation is visible (a WARN naming the phase, an `Ingested with Warnings`
# status, a phase_budget_exhausted counter) rather than silent.
#
# THE CONSTRAINT — two of them, and the second is the one that usually binds:
#   waves  x LLM_TIMEOUT_SECONDS  — 4 x 180 = 720 s at the defaults, against a
#                                    900 s ceiling, a 180 s margin;
#   ladder  (1 + LLM_MAX_RETRIES) x LLM_TIMEOUT_SECONDS  — 3 x 180 = 540 s,
#                                    comfortably under, and NOT what binds.
#                                    (720 s is the WAVE term above; the two are
#                                    different numbers that look alike.)
# Both are checked at import against the reference document rather than left to
# prose in four files an operator may not be reading, because the degradation is
# indistinguishable from a labelling-quality regression. Raising the per-call
# budget for a slower model DOES cross one: 300 s per call is 4 x 300 = 1200 s
# of waves, over the ceiling.
DATAPREP_LLM_PHASE_TIMEOUT_SECONDS = positive_float_env("DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", default=900.0)

# Why a phase degraded. A phase can stop early for reasons that have DIFFERENT
# fixes — an expired budget is fixed by raising the budget, a vLLM client that
# will not build is fixed by fixing the endpoint — so the phases report a reason
# string and the operator is told which knob applies. A bare boolean produced a
# message that named the budget for both, sending the operator to raise a knob
# that could not help. See _apply_contextualization.
#
# Sentinels, not free text: each one is the prefix of the reason the phase
# reports and keys its remedy in DEGRADED_REMEDIES. A reason carries detail its
# sentinel does not (the client-init error, how many chunks fell back), which is
# why causes are matched by prefix — see _degraded_cause.
DEGRADED_PHASE_BUDGET = "the phase ran out of its wall-clock budget with work unfinished"
DEGRADED_CLIENT_UNAVAILABLE = "the vLLM client could not be built"
DEGRADED_NO_CONTEXTS = "context generation returned nothing usable for any chunk"
DEGRADED_NO_LABELS = "the labelling model returned no labels for any chunk"
DEGRADED_WINDOW_TOO_SMALL = "the model window cannot fit a document context"

# The complete set, in one place, rather than a tuple written into the matcher.
# A sentinel missing from THIS list is invisible to _degraded_cause, which then
# falls through to reporting the reason verbatim — no remedy, silently. Keeping
# the roster here makes that a difference a test can assert on equality, instead
# of two lists that can drift apart with nothing to notice.
DEGRADED_CAUSES = (
    DEGRADED_PHASE_BUDGET,
    DEGRADED_CLIENT_UNAVAILABLE,
    DEGRADED_NO_CONTEXTS,
    DEGRADED_NO_LABELS,
    DEGRADED_WINDOW_TOO_SMALL,
)


def _degraded_cause(reason: str) -> str:
    """The sentinel *reason* belongs to, or *reason* itself when unknown.

    Prefix-matched because a phase appends its own detail to the sentinel: the
    client-init error text, and the ``0/N`` counts on the two that can produce
    nothing. Equality would only ever match a bare reason and quietly classify
    the decorated ones as unrecognised, which is the state that produced a
    remedy naming the wrong knob.

    An unrecognised reason falls through to itself so an unmapped cause is
    reported verbatim rather than filed under a cause that does not describe it.
    """
    for sentinel in DEGRADED_CAUSES:
        if reason.startswith(sentinel):
            return sentinel
    return reason


# What to tell the operator for each cause, keyed by its sentinel. Kept beside
# the sentinels rather than inlined at the call site so that adding a cause
# forces a decision about its remedy: a cause with no entry is reported verbatim
# with no remedy, which is visible, instead of inheriting a diagnosis about
# budgets or endpoints that may not apply to it.
#
# Every non-budget remedy says raising a budget will not help. That is the whole
# reason the causes are distinguished — an operator told to raise a ceiling for
# an endpoint that is down re-ingests into the identical failure.
DEGRADED_REMEDIES = {
    DEGRADED_PHASE_BUDGET: (
        "{phase}: the phase budget ran out after {seconds:g}s, so the batches still running were "
        "abandoned and fell back per chunk. Raise DATAPREP_LLM_PHASE_TIMEOUT_SECONDS, or the per-call "
        "MODEL_LLM_TIMEOUT_SECONDS together with it."
    ),
    DEGRADED_CLIENT_UNAVAILABLE: (
        "{phase}: the vLLM client could not be built. Raising a budget will not help — check "
        "VLLM_ENDPOINT and that the served model is discoverable (VLLM_MODEL_ID unset)."
    ),
    DEGRADED_NO_CONTEXTS: (
        "{phase}: every chunk came back without a generated context. Raising a budget will not help — "
        "the endpoint must be reachable and the model must support guided JSON "
        "(response_format=json_object)."
    ),
    DEGRADED_NO_LABELS: (
        "{phase}: every chunk fell back to the document's own labels — none, if the document has none — "
        "because the model returned nothing usable. Raising a budget will not help — the endpoint must "
        "be reachable and the model must support guided JSON (response_format=json_object)."
    ),
    DEGRADED_WINDOW_TOO_SMALL: (
        "{phase}: the serving model's context window leaves no room for a document context once the "
        "system prompt, the batch chunk text and the per-chunk output reservation are subtracted, so "
        "this document was ingested without contexts. Raising a budget will not help — set "
        "DATAPREP_MAX_MODEL_LEN to the window the endpoint serves (the only lever when it does not "
        "expose max_model_len), raise the model window on the GPU (vLLM --max-model-len), lower "
        "DATAPREP_LLM_LABEL_BATCH_SIZE or DATAPREP_CONTEXTUAL_MAX_TOKENS, or pin "
        "DATAPREP_CONTEXTUAL_DOC_BUDGET to a value you know fits."
    ),
}

# Document size the wave arithmetic above is stated for: the one in the incident
# report. Raising the ceiling is the fix for a larger document; this only makes
# the startup check speak about a concrete case instead of an abstract one.
_PHASE_REFERENCE_CHUNKS = 260


# Worst case for one batched call: every attempt at the full per-request budget.
def _one_batched_call_worst_case(retries: int, per_call_seconds: float) -> float:
    return (1 + retries) * per_call_seconds


def _phase_waves_for_reference_document(chunks: int | None = None) -> int:
    """Waves the reference document costs at the configured concurrency.

    ``_PHASE_REFERENCE_CHUNKS`` is the size of the document in the incident
    report. It is a reference, not a limit: the real count depends on the
    document being ingested, so this only says whether the SHIPPED default
    survives a document of that size with every call at its full budget.

    The default is read from the global inside the body, not as a default
    argument: a default is bound once at ``def`` time, which would both freeze
    the value and fail to resolve, since the constant is declared below.
    """
    if chunks is None:
        chunks = _PHASE_REFERENCE_CHUNKS
    batches = -(-chunks // LABEL_LLM_BATCH_SIZE)
    return -(-batches // max(1, MAX_CONCURRENT_BATCHES))


def _warn_if_phase_ceiling_too_low(phase_seconds: float, retries: int, per_call_seconds: float) -> bool:
    """Warn when the phase ceiling cannot outlast one call's retry ladder.

    Takes its arguments rather than reading the module globals so the condition
    is testable: at import time the values are already fixed, and the case worth
    testing is the one the shipped defaults never take.

    Returns whether it warned.
    """
    worst = _one_batched_call_worst_case(retries, per_call_seconds)
    waves = _phase_waves_for_reference_document()
    # The wave check is the one that binds. The single-call constraint is
    # necessary but not sufficient: a ceiling above one ladder still degrades a
    # large document whose calls each finish inside their own budget, because the
    # waves run back to back and share the one ceiling.
    needed = max(worst, waves * per_call_seconds)
    if phase_seconds > needed:
        return False
    logger.warning(
        "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS (%.0f s) does not exceed what one "
        "LLM phase needs: %d waves of the %d-chunk reference document x "
        "MODEL_LLM_TIMEOUT_SECONDS (%.0f s) = %.0f s, against a single call's "
        "worst case of %.0f s = (1 + MODEL_LLM_MAX_RETRIES=%d) x "
        "MODEL_LLM_TIMEOUT_SECONDS. Calls that are cancelled before they can "
        "return make labelling degrade to per-chunk and then to file labels — a "
        "symptom that reads as a labelling-quality regression rather than as a "
        "misconfiguration. Raise DATAPREP_LLM_PHASE_TIMEOUT_SECONDS above %.0f s, "
        "or lower DATAPREP_LLM_LABEL_BATCH_SIZE / raise DATAPREP_MAX_CONCURRENT_BATCHES to "
        "shorten the wave count.",
        phase_seconds,
        waves,
        _PHASE_REFERENCE_CHUNKS,
        per_call_seconds,
        waves * per_call_seconds,
        worst,
        retries,
        per_call_seconds,
        needed,
    )
    return True


_warn_if_phase_ceiling_too_low(DATAPREP_LLM_PHASE_TIMEOUT_SECONDS, LLM_MAX_RETRIES, LLM_TIMEOUT_SECONDS)
# How often a still-running phase reports progress to the ingestion log. The log
# is the only channel an operator watches during an ingest (the admin UI reads
# it), so a phase that is alive but slow has to say so — silence is what made
# the original stall undiagnosable.
DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS = positive_float_env("DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", default=60.0)
# How long a cancelled batch is given to unwind before the phase gives up on it.
# Long enough for a cooperative cancellation to close its HTTP connection and
# free its semaphore slot; short enough that the phase bound stays the outer
# limit. A task that has not finished by then is abandoned, which is what the
# caller's fallback is for.
_PHASE_CANCEL_GRACE_SECONDS = 5.0

# Contextual Retrieval (Anthropic-style): per-chunk LLM-generated document
# context prepended to each chunk before embedding + labeling, so chunks carry
# document-level subject (fixes label/embedding context loss; see
# spec-contextual-retrieval.md). Default ON; set false to disable (no-op beyond
# skipping context gen). Adds one LLM call per chunk (concurrency-bounded) when
# enabled. Part B (retriever BM25 hybrid) is a separate spec.
# BREAKING CHANGE (v1.3 → v1.5): default changed from "false" to "true".
# Enables Contextual Retrieval (Anthropic-style) by default — adds one vLLM call
# per chunk at ingest (~20% slower, higher quality embeddings). Set to "false" to
# restore v1.3 behavior.
CONTEXTUAL_RETRIEVAL_ENABLED = os.getenv("CONTEXTUAL_RETRIEVAL_ENABLED", "true").lower() == "true"
# Model used for context generation. Empty → reuse VLLM_MODEL_ID (auto-detected
# on remote GPU nodes). Set to a smaller/cheaper model to cut context-gen cost.
DATAPREP_CONTEXTUAL_MODEL = os.getenv("DATAPREP_CONTEXTUAL_MODEL", "")
# Max chars of the joined document chunks fed to the context-generation LLM.
# Filename + file_labels are always included.
#
# This was a fixed literal (100000 in code, 6000 in docker-compose) sized for
# the T4 profile's 2048-token window and then applied to EVERY deployment —
# including the default, which runs a 65536-token window where it uses ~4% of
# what is available. Wrong in both directions at once. It is now DERIVED from
# the serving model's window, discovered at runtime from the LLM endpoint (see
# _serving_model_window / _resolve_doc_budget), and this variable is only an
# operator override:
#
#   unset / 0 -> derive from the discovered serving-model window
#   > 0       -> explicit operator override
#   < 0       -> explicitly disable truncation
#
# Deriving per install is the fix; a single literal cannot be correct for a T4
# (2048) and a default install (65536) at the same time.
DATAPREP_CONTEXTUAL_DOC_BUDGET = _env_int("DATAPREP_CONTEXTUAL_DOC_BUDGET", 0)
# ~4 chars/token for English prose + markdown. Same figure the budget comment
# above has always used; the clamp in _resolve_doc_budget absorbs the error.
CHARS_PER_TOKEN = 4
# The document context the LLM receives is the budgeted document text PLUS
# the lines around it: the filename line, the labels line, this header and
# the truncation marker. None of that is inside the budget, so it is
# measured and reserved separately — a request sized without it overflows
# the window by exactly those characters. The filename and the labels are
# per document and unbounded (a long file name, a long label list), so the
# reservation is computed, not guessed: see _doc_context_scaffold_chars.
DOC_CONTEXT_HEADER = "Document content (may be truncated):\n"
DOC_CONTEXT_TRUNCATION_MARKER = "...[truncated]"
# The user turn of the doc_level call (the same string the request sends).
DOC_LEVEL_USER_TURN = "Write the document-level context."
# When window discovery has no answer (endpoint unreachable, or a strict
# OpenAI-compatible provider that does not expose max_model_len), assume the
# SMALLEST profile we support — and say so (see _serving_model_window). A
# budget that only fits on hardware nobody runs fails closed; defaulting to
# the largest window would silently produce prompts the GPU cannot accept.
DERIVE_FALLBACK_WINDOW = 2048
# Doc-context budget for the doc_level strategy (ONE call, so it can afford a
# much larger window than per_chunk). ~4 chars/token. This is a MAXIMUM: the
# window the endpoint serves caps it, so the 100000-char default cannot
# overflow a deployment that serves less (a rejected call falls back to raw
# chunks silently). Set 0 to let the window decide entirely. Docs larger than
# the budget are truncated — Map-Reduce hierarchical summarization is the
# future fix for that case.
DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL = _env_int("DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL", 100000)
# Strategy when CONTEXTUAL_RETRIEVAL_ENABLED=true:
#   "per_chunk" (default) — one LLM call per chunk; each chunk gets a context
#      tailored to its section (Anthropic recipe; highest quality, N calls/doc).
#   "doc_level"           — ONE LLM call for the whole document; the same
#      document-level context is prepended to every chunk (N× cheaper; still
#      propagates the document subject — enough to fix label/embedding loss).
CONTEXTUAL_STRATEGY = os.getenv("CONTEXTUAL_STRATEGY", "per_chunk").strip().lower() or "per_chunk"
# Decoupled mode: when true (default), label the RAW chunk and use the generated
# context ONLY for the embedding. Recommended — keeps label precision (the
# labeler sees the raw chunk) while propagating the document subject via the
# vector. When false, the context is fed to both embedding and labeling.
CONTEXTUAL_LABEL_RAW = os.getenv("CONTEXTUAL_LABEL_RAW", "true").lower() == "true"
# Max output tokens for the context-generation LLM calls (doc-level + per-chunk).
# The model writes a 50-100 word context (~196 tokens observed on large docs); the
# legacy hard cap of 200 left no headroom, so under concurrent vLLM load the JSON
# `{"context":"..."}` was truncated mid-string -> JSONDecodeError -> raw-chunk
# fallback. 512 gives comfortable margin at no extra cost (the model stops early).
CONTEXTUAL_MAX_TOKENS = _sanitize_output_tokens(_env_int("DATAPREP_CONTEXTUAL_MAX_TOKENS", 512), 512)


# Explicit statement of the context window (tokens) the LLM endpoint serves.
# 0 = discover it at runtime from the endpoint (see _serving_model_window);
# >0 = the deployer states it. The override is the only lever on a strict
# OpenAI-compatible provider (its /v1/models carries no max_model_len, so
# discovery never answers) and the way to state the window of a
# DATAPREP_CONTEXTUAL_MODEL that is not the model the endpoint lists first.
DATAPREP_MAX_MODEL_LEN = _sanitize_window_override(_env_int("DATAPREP_MAX_MODEL_LEN", 0))

# Spec 5.3: Externalized Prompt - Two-tier priority
# Level 1: ENV VAR (highest priority) - override via .env
# Level 2: Hardcoded default (fallback) - works out-of-the-box
_LABEL_SELECTOR_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You are a precise semantic labeler for a RAG knowledge graph.
Goal: Assign 1–4 MOST RELEVANT labels from the list below that best match the chunk content.
Rules:
- Return ONLY labels that are strongly relevant.
- Most chunks get 1–3 labels. Never exceed 5.
- Do NOT "maximize" coverage.
- Do NOT suggest new labels.
- Use ONLY exact strings from the list.

Labels:
{labels_list}

Output format (STRICT):
- Return ONLY a JSON object — no prose, no markdown, no code fences.
- The value is ALWAYS an array of strings.
- For a chunk with no matching label, use an empty array [] (never null).
Example:
{"labels": ["Label1", "Label2"]}
</SYSTEM INSTRUCTIONS>
""".strip()
_env_value = os.getenv("LABEL_SELECTOR_SYSTEM_PROMPT", "")
LABEL_SELECTOR_SYSTEM_PROMPT = _env_value.strip() or _LABEL_SELECTOR_DEFAULT

# Contextual Retrieval prompt (two-tier: env override, else built-in default).
# {document_context} is replaced per ingestion with filename + labels + doc text.
_CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You place a text chunk inside its parent document so the chunk can be
retrieved even when it does not name the document's subject.

Given the DOCUMENT CONTEXT (the document's subject and scope) and one CHUNK
from that document, write a 50-100 word context that states what the document
is and what this specific chunk is about, so the chunk can be found by searches
about the document's subject. Use only facts from the document context and the
chunk — do not invent details.

DOCUMENT CONTEXT:
{document_context}

Output format (STRICT): return ONLY a JSON object — no prose, no markdown, no
code fences.
- Single chunk input → {"context": "<50-100 word context>"}.
- Multiple chunks input (a JSON list of {"index": i, "text": ...}) →
  {"contexts": {"<index>": "<50-100 word context>", ...}} with one entry per
  input chunk.
Example (single): {"context": "This chunk is from the CENTA cucumber cultivation
guide. It covers irrigation scheduling for cucumber crops."}
</SYSTEM INSTRUCTIONS>
""".strip()
_ctx_env = os.getenv("CONTEXTUAL_RETRIEVAL_PROMPT", "")
CONTEXTUAL_RETRIEVAL_PROMPT = _ctx_env.strip() or _CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT

# Document-level context prompt (used by the CONTEXTUAL_STRATEGY=doc_level path;
# built-in default, not env-overridable — customize CONTEXTUAL_RETRIEVAL_PROMPT
# for the per_chunk path if needed).
_CONTEXTUAL_DOC_PROMPT_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You write a short context that describes what a document IS, so any chunk from
it can be retrieved by searches about the document's subject.

Given the DOCUMENT CONTEXT (subject + scope), write a 50-100 word description of
the document: what it is, its subject, and its scope. Use only facts from the
document context — do not invent details.

DOCUMENT CONTEXT:
{document_context}

Output format (STRICT): return ONLY a JSON object — no prose, no markdown, no
code fences.
Example: {"context": "A CENTA cucumber cultivation guide covering planning
through post-harvest for cucumber crops in tropical climates."}
</SYSTEM INSTRUCTIONS>
""".strip()


def _build_vllm_client(endpoint: str | None = None) -> tuple[AsyncOpenAI, str]:
    """Construct the AsyncOpenAI client for the self-hosted vLLM and resolve the model.

    The explicit VLLM_MODEL_ID env wins (deployer override); otherwise the
    model id is discovered at VLLM_ENDPOINT (TTL-cached, see
    core/model_cache.py) and fails loudly when nothing answers — a guessed
    name is rejected by vLLM's model-name validation.
    Shared by labeling and Contextual-Retrieval context generation.

    ``endpoint`` lets a caller that already read VLLM_ENDPOINT pass it in:
    the window must be probed on the SAME server the generation calls, and
    two independent reads of that env var are two sources of truth about
    which server it is.
    """
    _api_key = os.getenv("VLLM_API_KEY", "EMPTY")
    _vllm_endpoint = endpoint if endpoint is not None else os.getenv("VLLM_ENDPOINT")
    # Shared request budget (core/model_http_policy.py): the openai-python
    # defaults (600 s, 2 retries) let a heavily contended shared GPU stall
    # labeling/context batches for 10+ minutes with no feedback
    # (live-observed). Env-tunable deck-wide; the fallback chain (batch ->
    # per-chunk -> file labels) keeps ingestion alive either way.
    client = AsyncOpenAI(
        api_key=_api_key,
        base_url=f"{_vllm_endpoint}/v1",
        timeout=http_timeout(LLM_TIMEOUT_SECONDS),
        max_retries=LLM_MAX_RETRIES,
    )
    model = resolve_model_id(_vllm_endpoint)
    return client, model


def _build_vllm_client_and_window() -> tuple[AsyncOpenAI, str, int, bool]:
    """Client, model, the serving model's window and whether that window is
    authoritative — resolved together.

    One endpoint read, so the window is probed on the same server the
    generation calls. One thread hop, because both probes are synchronous
    HTTP calls that can take their whole timeout when the endpoint does not
    answer: on the ingest path a blocked event loop freezes the phase
    heartbeats and every concurrent request the process serves.

    The window is resolved BEFORE the client is built, so its own failure
    (no answer, no max_model_len) is reported even when the client build
    fails — the operator then gets the window remedy, not only a client
    error. On a DOWN endpoint the two probes are separate requests (the
    model-id field has no negative cache), so the first ingest waits for
    both.

    The model the generation requests name — DATAPREP_CONTEXTUAL_MODEL when
    set, the resolved model id otherwise — is what the window has to match,
    and it is computed here.
    """
    endpoint = os.getenv("VLLM_ENDPOINT", "")
    # The window FIRST: its own failure (no answer, no max_model_len) must
    # still be reported even when the client build below fails — otherwise
    # the loud fallback warning is unreachable exactly when the endpoint is
    # down, and the operator gets a client error that names no remedy.
    window, authoritative = _serving_model_window(endpoint)
    client, model = _build_vllm_client(endpoint)
    # The mismatch check compares the model the request names with the one the
    # endpoint lists first: the explicit contextual model when it is set, the
    # resolved model id otherwise. It only makes sense for a DISCOVERED
    # window — an override is the operator's own statement (they set it
    # precisely because discovery could not answer), and the fail-closed
    # fallback is a guess, not a model.
    if DATAPREP_MAX_MODEL_LEN <= 0 and authoritative:
        _warn_on_contextual_model_mismatch(endpoint, window, DATAPREP_CONTEXTUAL_MODEL.strip() or model)
    return client, model, window, authoritative


# Keys of the warnings already emitted ("already warned" set). The window
# problems are per-deployment facts, not per-document ones: a bulk import
# would otherwise ship one identical line per document — the volume is what
# teaches operators to ignore the line.
_WINDOW_WARNED: set[str] = set()
_WINDOW_WARNED_LOCK = threading.Lock()


def _doc_context_scaffold_chars(input) -> int:
    """The characters a document context spends OUTSIDE the budget.

    Mirrors _build_doc_context exactly: the filename line, the labels line,
    the header and the truncation marker. The filename and the labels are
    per document and unbounded, so they are MEASURED — a fixed allowance
    would be exceeded by an ordinary long file name.
    """
    filename = os.path.basename(getattr(input, "storage_path", "") or getattr(input, "file_path", "") or "")
    file_labels = list(getattr(input, "file_labels", []) or [])
    prefix_parts = []
    if filename:
        prefix_parts.append(f"Filename: {filename}")
    if file_labels:
        prefix_parts.append(f"Document labels: {', '.join(file_labels)}")
    prefix = "\n".join(prefix_parts)
    return (
        len(prefix)
        + (1 if prefix else 0)  # the newline joining the prefix to the header
        + len(DOC_CONTEXT_HEADER)
        + len(DOC_CONTEXT_TRUNCATION_MARKER)
    )


def _batch_user_turn_chars(chunks: list[str]) -> int:
    """The EXACT length of the batched user turn.

    The request sends ``json.dumps([{"index": i, "text": t}, ...])``, whose
    default ``ensure_ascii=True`` expands every non-ASCII character to a
    six-character escape — a Spanish or French document needs a third more
    room than its raw text suggests. Measuring the serialized payload is the
    only way to reserve what is actually sent.
    """
    return len(json.dumps([{"index": i, "text": t} for i, t in enumerate(chunks)]))


def _warn_once(key: str, message: str) -> None:
    """Log ``message`` once per ``key`` for the lifetime of the process.

    The set is shared by the worker threads that resolve the window, so the
    check-and-add is done under a lock: without it, concurrent ingests can
    all pass the membership test and the identical line ships N times — the
    volume is exactly what teaches operators to ignore it.
    """
    with _WINDOW_WARNED_LOCK:
        if key in _WINDOW_WARNED:
            return
        _WINDOW_WARNED.add(key)
    logger.warning(message)


def _serving_model_window(endpoint: str) -> tuple[int, bool]:
    """The serving model's context window in tokens, in three tiers.

    1. DATAPREP_MAX_MODEL_LEN (import-time constant) wins — the deployer's
       explicit statement of the window the endpoint serves. It is the lever
       for a strict OpenAI-compatible provider that serves /v1/models without
       a ``max_model_len`` field (discovery can never answer there), and for
       a deployment whose context model (DATAPREP_CONTEXTUAL_MODEL) is not
       the one the endpoint lists first (see the mismatch note below). When
       it disagrees with the served window, that is warned about too: an
       override larger than what the server accepts recreates exactly the
       silent overflow this issue exists to stop.
    2. Otherwise the endpoint is probed (core/model_cache.py): the window the
       vLLM server actually serves, TTL-cached and sharing the probe with
       model-id detection — the same pattern as chatqna's _get_max_model_len.
    3. The explicit fallback (DERIVE_FALLBACK_WINDOW, the smallest supported
       profile) when the probe has no answer, with a warning naming the
       consequence and the remedy.

    Issue #1182: this window used to be read from the VLLM_MAX_MODEL_LEN env —
    the vLLM-side memory knob (``--max-model-len`` in compose) — with a silent
    2048 fallback when it did not reach the container. The env is a static copy
    of what vLLM was configured with, not what it serves: raise the window on
    the GPU node and the copy goes stale in every direction at once. The
    endpoint is the source of truth.

    Tiering stays here rather than in core/model_cache.py: that module owns
    the probe and the cache, but the two consumers of ONE probe legitimately
    disagree on the no-answer posture — dataprep sizes a request budget and
    fails CLOSED (the smallest profile: a budget that fits nowhere fails
    visibly), chatqna asks the model to answer and falls back to the
    project-standard Granite window. Consolidating them is a separate change
    from this one.

    Returns ``(window, authoritative)``. ``authoritative`` is False for the
    fail-closed fallback — a GUESS, not knowledge of the served window — and
    the budget resolver uses that to leave an operator's explicit budget
    alone instead of capping it against a number nobody knows.
    """
    discovered = get_max_model_len(endpoint)
    if DATAPREP_MAX_MODEL_LEN > 0:
        if discovered and discovered != DATAPREP_MAX_MODEL_LEN:
            _warn_once(
                f"override|{endpoint}",
                f"Contextual Retrieval: DATAPREP_MAX_MODEL_LEN={DATAPREP_MAX_MODEL_LEN} does not match the "
                f"window {endpoint} serves ({discovered} tokens) — document contexts sized for "
                f"{DATAPREP_MAX_MODEL_LEN} are rejected when it is the larger of the two, and the "
                f"batches fall back to raw chunks. Align the override with the served window.",
            )
        return DATAPREP_MAX_MODEL_LEN, True
    if discovered:
        return discovered, True

    _warn_once(
        f"fallback|{endpoint}",
        f"Contextual Retrieval: no model window discovered at VLLM_ENDPOINT={endpoint or '<unset>'}; "
        f"deriving document-context budgets from the fail-closed fallback of {DERIVE_FALLBACK_WINDOW} "
        f"tokens (the smallest profile we support) — larger documents get their context truncated to "
        f"that budget. Make the endpoint answer the /v1/models probe (failures logged by "
        f"core.model_cache), set DATAPREP_MAX_MODEL_LEN to the window it serves, or set the "
        f"document-context budget explicitly (DATAPREP_CONTEXTUAL_DOC_BUDGET, or "
        f"DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL under the doc_level strategy).",
    )
    return DERIVE_FALLBACK_WINDOW, False


def _warn_on_contextual_model_mismatch(endpoint: str, window: int, named_model: str) -> None:
    """Warn when the model the request names is not the model the endpoint lists first.

    Discovery reads the FIRST entry of /v1/models (core/model_cache.py), so the
    window it reports is that model's. The contexts are generated by
    DATAPREP_CONTEXTUAL_MODEL when it is set, and otherwise by the resolved
    model id (VLLM_MODEL_ID or the discovered one). A vLLM server hosting
    several models can then serve a smaller window for the model that answers
    than the one discovery reported — the budget would be sized for the wrong
    model and the request would be rejected (silently falling back to raw
    chunks). The mismatch cannot be resolved from here (the probe exposes one
    model), so it is surfaced and the operator is pointed at the override.
    """
    discovered_model = get_model_id(endpoint)
    if not discovered_model:
        return
    # The same model is often served under a namespaced id
    # ("ibm-granite/granite-4.1-8b") while the deployment names it without
    # the namespace ("granite-4.1-8b") — that is an alias, not a mismatch.
    # Two DIFFERENT namespaces are not: "org-a/granite" and "org-b/granite"
    # can serve different windows, so the full ids are compared then.
    discovered_ns, _, discovered_base = discovered_model.rpartition("/")
    named_ns, _, named_base = named_model.rpartition("/")
    same_model = discovered_model == named_model if discovered_ns and named_ns else discovered_base == named_base
    if same_model:
        return
    _warn_once(
        f"mismatch|{endpoint}|{named_model}",
        f"Contextual Retrieval: the contexts are generated by {named_model}, but VLLM_ENDPOINT="
        f"{endpoint or '<unset>'} lists {discovered_model} first, so the discovered window "
        f"({window} tokens) may not be the one {named_model} serves — document contexts sized for it "
        f"could be rejected. Set DATAPREP_MAX_MODEL_LEN to the window {named_model} serves.",
    )


async def ensure_vector_index(
    collection,
    *,
    metric: str = "cosine",
    n_lists: int = 1,
    field: str = "embedding",
    graph_name: str | None = None,
    file_id: str | None = None,
    write_ingestion_log=None,
) -> str | None:
    """Idempotent, dim/metric/nLists-aware vector-index creation. Never raises.

    Closes the gap where langchain-arangodb would lazy-create an index with
    nLists=1 (defeats ANN) and silently skip dim-staleness when the embedder
    dimension changes (bge-base 768 -> bge-large 1024). See issue #1002.

    Decision matrix:
      - no vector index on `field`                     -> create at current dim
      - index exists, dim differs                      -> delete + recreate
      - index exists, dim matches, metric/nLists drift -> delete + recreate
      - index exists, dim + metric + nLists match      -> no-op (idempotent)
      - collection is empty                            -> INFO log, return None
      - sample document lacks valid embedding          -> ERROR log, return None
      - any add_index / delete_index exception         -> ERROR log, return None

    Note: `metric` is normalized to lowercase here (langchain-arangodb stores
    it lowercase). Pass either case; the helper reconciles.

    Note: this helper manages the index under the canonical langchain-arangodb
    name `vector_index` (its default `ArangoVector.vector_index_name`), so the
    retriever queries the SAME index the dataprep maintains. Older deployments
    that shipped the previous fix's `idx_embedding_<dim>` name are pruned as
    orphans so only `vector_index` remains.

    Known limitation: on heterogeneous-dim collections (partial bge-base→bge-large
    migration in progress), `collection.random()` may sample an outlier dim and
    flap the index across consecutive ingests. Workaround: complete the partial
    migration (re-ingest all old docs) before relying on auto-recreation. The
    common case — homogeneous-dim collections — is unaffected.
    """
    # Normalize metric at the helper boundary — matches langchain-arangodb's
    # internal DISTANCE_MAPPING (lowercase). Accepts both casings from callers.
    metric = metric.lower() if isinstance(metric, str) else metric

    with with_span(
        "dataprep.ensure_vector_index",
        attributes={"dataprep.graph_name": graph_name or ""},
    ) as span:
        try:
            if collection.count() == 0:
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        "Empty collection; skipping index ensure.",
                    )
                return None
            sample = collection.random()
            emb = sample.get(field)
            if not isinstance(emb, list) or len(emb) == 0:
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "ERROR",
                        "VectorIndex",
                        f"Sampled document lacks a valid `{field}` list; skipping.",
                    )
                return None
            dim = len(emb)
            desired_name = "vector_index"
            span.set_attribute("dataprep.index_dim", dim)
            span.set_attribute("dataprep.index_action", "skip")

            existing = collection.indexes()
            # The canonical `vector_index` is the langchain-arangodb default
            # (`ArangoVector.vector_index_name`) and the only index the
            # retriever queries.
            vec_idx = next(
                (
                    i
                    for i in existing
                    if i.get("name") == desired_name and i.get("type") == "vector" and field in i.get("fields", [])
                ),
                None,
            )

            def _build_index():
                return {
                    "name": desired_name,
                    "type": "vector",
                    "fields": [field],
                    "params": {"dimension": dim, "metric": metric, "nLists": n_lists},
                }

            if vec_idx is None:
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "create")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Created {desired_name} (dim={dim}, metric={metric}, nLists={n_lists}).",
                    )
                return desired_name

            existing_dim = vec_idx.get("params", {}).get("dimension")
            if existing_dim != dim:
                collection.delete_index(vec_idx["name"])
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "recreate")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Recreated index for dim {existing_dim} -> {dim} (name={desired_name}).",
                    )
                return desired_name

            params = vec_idx.get("params", {})
            existing_metric = (
                (params.get("metric") or "").lower() if isinstance(params.get("metric"), str) else params.get("metric")
            )
            if existing_metric != metric or params.get("nLists") != n_lists:
                # Metric/nLists are structural — ArangoDB cannot patch them in
                # place on an existing vector index; drop + recreate.
                collection.delete_index(vec_idx["name"])
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "recreate")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Recreated index '{vec_idx['name']}' -> '{desired_name}' "
                        f"(metric/nLists drift: have={existing_metric}/{params.get('nLists')} "
                        f"want={metric}/{n_lists}).",
                    )
                return desired_name
            # Idempotent no-op.
            return vec_idx["name"]
        except Exception as e:
            if write_ingestion_log and file_id:
                await _safe_log(
                    write_ingestion_log,
                    file_id,
                    "ERROR",
                    "VectorIndex",
                    f"ensure_vector_index failed: {type(e).__name__}: {str(e)[:200]}",
                )
            return None


def _read_index_params():
    """Read RETRIEVER_ARANGO_{DISTANCE_STRATEGY,NUM_CENTROIDS} defensively.

    Returns (metric, n_lists). On invalid NUM_CENTROIDS, logs a WARNING and
    falls back to 1 (the legacy default). Never raises — a malformed env var
    must not crash ingest.
    """
    metric = os.getenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "COSINE").lower()
    raw = os.getenv("RETRIEVER_ARANGO_NUM_CENTROIDS", "1")
    try:
        n_lists = int(raw)
    except ValueError:
        logger.warning(f"Invalid RETRIEVER_ARANGO_NUM_CENTROIDS={raw!r}; falling back to 1.")
        n_lists = 1
    return metric, n_lists


def _canonical_taxonomy_order(groups: list[tuple[str, list[str]]]) -> list[str]:
    """Return the taxonomy labels in a canonical, process-independent order.

    Each group is a category and the services under it. A category's own name
    sorts ahead of its services, so the prompt keeps the shape the backend
    returns — a category and the services under it stay together — while the
    order inside a group comes from the labels themselves: the case-folded
    name first, the exact name as the tie-break, so two labels differing only
    in case still have a defined order. A group with no name of its own (a
    category whose translation is missing) keeps its services together at the
    front.

    The order does not depend on the order the taxonomy arrives in, and it is
    identical from one process to the next. An unordered collection cannot
    supply it: set iteration order follows the interpreter's per-process string
    hash seed, so the same taxonomy would produce a different prompt in every
    container — and the LLM may then label the same chunk differently, a
    difference that is invisible in the stored result.

    Duplicates are collapsed, keeping the first occurrence in that order; the
    arrival order is preserved on the way in — a set would resolve two labels
    with the same sort key by hash, which is the dependence this function
    exists to remove.
    """
    keyed: list[tuple[tuple[str, str, int, str, str], str]] = []
    for category, services in groups:
        group_key = (category.casefold(), category)
        if category:
            keyed.append(((*group_key, 0, "", ""), category))
        for service in services:
            keyed.append(((*group_key, 1, service.casefold(), service), service))
    keyed.sort(key=lambda entry: entry[0])
    return list(dict.fromkeys(label for _, label in keyed))


async def _safe_log(write_ingestion_log, file_id, level, component, message):
    """Write one ingestion-log row, swallowing any exception it raises.

    Critical: the helper must never let a logging failure escape. Every caller
    is inside the ingest path — `ensure_vector_index`, and the phase heartbeat
    and budget-exhaustion reports of both LLM phases — where a propagated
    backend HTTP timeout would be caught by the outer except in
    `ingest_file_with_guardrail`, triggering `retract_file()` and DELETING
    already-committed chunks. Visibility loss on logs is acceptable; data
    loss is not.
    """
    if not write_ingestion_log or not file_id:
        return
    try:
        await write_ingestion_log(file_id, level, component, message)
    except Exception as e:
        logger.error(
            f"_write_ingestion_log failed while reporting {component!r}: "
            f"{type(e).__name__}: {str(e)[:200]} (message was: {message[:100]})"
        )


# ── Remote-LLM resilience (David, 2026-09-09: "build the resilience now") ──
# The remote vLLM gateway throws transient 502/503/504 storms lasting seconds
# to minutes while staying healthy between bursts. Absorb them: per-call
# exponential backoff with jitter, a shared storm cool-down so concurrent
# batches stop hammering a struggling gateway, and a second per-concept round
# for failed batches. Only TRANSIENT classes retry (5xx + connection errors);
# 4xx (auth/model errors) fail fast. Honest accounting is untouched: when
# retries exhaust, the row fails loudly through the 'Ingestion Error' path —
# resilience must NEVER reintroduce silent success (the P0 lesson).
_LLM_RETRY_ATTEMPTS = max(1, int(os.getenv("OKF_LLM_RETRY_ATTEMPTS", "5") or 5))
_LLM_RETRY_BASE_MS = max(250, int(os.getenv("OKF_LLM_RETRY_BASE_MS", "2000") or 2000))
_LLM_RETRY_MAX_MS = max(_LLM_RETRY_BASE_MS, int(os.getenv("OKF_LLM_RETRY_MAX_MS", "90000") or 90000))
_LLM_STORM_COOLDOWN_S = max(0, int(os.getenv("OKF_LLM_STORM_COOLDOWN_S", "20") or 20))
_LLM_STORM_COOLDOWN_MAX_S = max(_LLM_STORM_COOLDOWN_S, int(os.getenv("OKF_LLM_STORM_COOLDOWN_MAX_S", "120") or 120))
_LLM_ROUND2_DELAY_S = max(0, int(os.getenv("OKF_LLM_ROUND2_DELAY_S", "45") or 45))

_LLM_STORM_UNTIL = 0.0  # module-level monotonic timestamp — the SHARED cool-down
_LLM_STORM_STRIKES = 0

_TRANSIENT_LLM_MARKERS = (
    "502",
    "503",
    "504",
    "Bad Gateway",
    "Service Unavailable",
    "Gateway Timeout",
    "InternalServerError",
)
_TRANSIENT_CONN_MARKERS = (
    "connection",
    "Connection",
    "timeout",
    "Timeout",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "RemoteProtocol",
    "IncompleteRead",
    "socket hang up",
)


def _is_transient_llm_error(err) -> bool:
    text = f"{type(err).__name__}: {err}"
    return any(m in text for m in _TRANSIENT_LLM_MARKERS) or any(m in text for m in _TRANSIENT_CONN_MARKERS)


def _llm_retry_delay_s(attempt: int) -> float:
    """Jittered exponential backoff: ~2s/5s/15s/40s/90s at the defaults."""
    import random

    base_ms = min(_LLM_RETRY_MAX_MS, _LLM_RETRY_BASE_MS * (2.5**attempt))
    return base_ms * (0.85 + 0.3 * random.random()) / 1000.0


async def _llm_storm_wait():
    """Shared adaptive cool-down: after consecutive transient failures,
    concurrent callers pause before hitting the gateway again."""
    global _LLM_STORM_UNTIL
    import time

    now = time.monotonic()
    if now < _LLM_STORM_UNTIL:
        await asyncio.sleep(_LLM_STORM_UNTIL - now)


async def _call_llm_resilient(afn, *, what: str):
    """Run one LLM call (``afn`` is a zero-arg factory returning an awaitable)
    with the transient-failure retry ladder + storm cool-down. Returns the
    result; raises the LAST error when the ladder exhausts. 4xx classes raise
    immediately (retrying an auth/model error can never succeed)."""
    global _LLM_STORM_UNTIL, _LLM_STORM_STRIKES
    import time

    last = None
    for attempt in range(_LLM_RETRY_ATTEMPTS):
        await _llm_storm_wait()
        try:
            result = await afn()
            _LLM_STORM_STRIKES = 0  # a success ends the storm
            return result
        except Exception as e:  # noqa: BLE001 — classified below
            last = e
            if not _is_transient_llm_error(e):
                raise
            _LLM_STORM_STRIKES += 1
            _LLM_STORM_UNTIL = time.monotonic() + min(
                _LLM_STORM_COOLDOWN_MAX_S,
                float(_LLM_STORM_COOLDOWN_S) * (2 ** min(_LLM_STORM_STRIKES, 6)),
            )
            delay = _llm_retry_delay_s(attempt)
            logger.warning(
                f"[ llm-resilience ] {what}: transient failure "
                f"(attempt {attempt + 1}/{_LLM_RETRY_ATTEMPTS}): {type(e).__name__}: "
                f"{str(e)[:160]} — retrying in {delay:.1f}s"
            )
            await asyncio.sleep(delay)
    raise last


async def _settle_and_retrieve(tasks, *, timeout=None) -> tuple[bool, BaseException | None]:
    """Wait *tasks* out for *timeout* seconds, then drain their outcomes.

    Returns ``(interrupted, absorbed)`` — whether an outer cancellation arrived
    while the wait was running, and the ``CancelledError`` it delivered.

    *timeout* defaults to ``_PHASE_CANCEL_GRACE_SECONDS``, read from the module
    global at call time rather than as a default argument: a default is bound
    once when the ``def`` runs, which would freeze the window and quietly
    ignore a test (or a future operator hook) that retunes it.

    The absorbed exception is returned rather than discarded because a caller
    that has to raise *something* must raise THAT object. A freshly constructed
    ``CancelledError`` carries none of the original's identity, so an enclosing
    ``asyncio.timeout`` cannot recognise its own expiry and reports a generic
    cancellation instead of ``TimeoutError``.

    The wait runs as its own task behind ``asyncio.shield`` because an await in
    a cancellation path is itself cancellable: without the shield, a second
    cancellation — the kill endpoint is idempotent-callable, so a double-clicked
    Kill re-enters it, and any shutdown sweep cancels the same task again —
    propagates straight out and skips the window entirely. The batches would
    then be abandoned running, which is the exact outcome the window exists to
    prevent, and worse than the ``asyncio.gather`` this replaced: gather had no
    window to lose.
    """
    tasks = [t for t in tasks if not t.done()]
    if not tasks:
        return False, None
    if timeout is None:
        timeout = _PHASE_CANCEL_GRACE_SECONDS
    wait = asyncio.ensure_future(asyncio.wait(tasks, timeout=timeout))
    absorbed: BaseException | None = None
    while not wait.done():
        try:
            await asyncio.shield(wait)
        except asyncio.CancelledError as exc:
            # Deliberately swallowed: the settle is the thing we promised, and
            # it has a timeout of its own, so it cannot hold the caller longer
            # than the timeout regardless of how often we are cancelled.
            #
            # uncancel() with it. Since 3.11 a task that catches CancelledError
            # to do cleanup is expected to decrement task.cancelling(), because
            # asyncio.timeout and TaskGroup read that counter to decide whether
            # a cancellation is still live. Leaving it at 1 on a task that then
            # returns normally is how a swallowed deadline stops a timeout from
            # ever firing. Nothing in this overlay wraps an ingest in one today —
            # this is the documented pairing, not a reaction to a live outage.
            #
            # Kept rather than dropped: the caller re-raises this exact object so
            # the signal survives, and an enclosing deadline can still tell it
            # apart from a kill.
            absorbed = exc
            current = asyncio.current_task()
            if current is not None:
                current.uncancel()
    for task in tasks:
        if task.done() and not task.cancelled():
            with suppress(Exception):
                task.exception()
    return absorbed is not None, absorbed


async def _run_uninterruptible(coro, *, timeout: float, label: str) -> bool:
    """Run *coro* to completion even if the caller is cancelled meanwhile.

    Returns True if a cancellation was absorbed while it ran.

    For work that destroys data: the kill handler's rollback is a chain of
    awaits, and a second cancel — which a double-clicked Kill produces, the same
    re-entrancy ``_settle_and_retrieve`` exists to absorb — used to land on its
    first await and skip the rest, leaving the document half-retracted with a
    status that never reached "Killed". The window bounds how long that can
    hold the caller; past it the coroutine is left running rather than killed,
    because an overrunning rollback is recoverable and an interrupted one is not.
    """
    task = asyncio.ensure_future(coro)
    interrupted, _ = await _settle_and_retrieve([task], timeout=timeout)
    if not task.done():
        logger.error(
            f"{label} did not finish within {timeout:g}s and is still running; "
            "it was left to complete rather than cancelled. Note the file lock is "
            "released when the caller unwinds, so a re-ingest of the same document "
            "can start while this rollback is still deleting"
        )
    elif task.cancelled():
        logger.error(f"{label} was cancelled before it could complete")
    else:
        # _settle_and_retrieve retrieves the exception to silence asyncio's
        # "never retrieved" warning, which DISCARDS it. Left at that, a rollback
        # that failed was completely silent: before the refactor the same
        # exception propagated out of the handler and was at least visible, and
        # nothing downstream reads it either. The AQL path self-reports through
        # the ingestion log; a socket error, an unwrapped driver error, or a
        # failure inside the status write itself does not, so it is logged here.
        exc = task.exception()
        if exc is not None:
            logger.error(f"{label} FAILED and the document may be partially retracted: {exc!r}")
    return interrupted


# How long the kill switch's rollback may hold a cancelled ingest. Long enough
# for the full cascade — chunks, edges, orphans — plus the status flip, on a
# loaded database. Only reached when an operator cancels the same ingest twice.
_ROLLBACK_CANCEL_GRACE_SECONDS = 60.0


async def _gather_with_phase_budget(
    tasks: list, *, phase: str, phase_label: str, total: int, file_id: str, write_ingestion_log
) -> tuple[list, bool]:
    """Run *tasks* concurrently under a wall-clock bound, reporting progress.

    Wraps ``_gather_with_phase_budget_inner`` in a span, because the phase-bound
    path is the one that had no span to write to. ``dataprep.llm.timed_out`` is
    emitted from the per-call timeout handler inside a batch; a batch cancelled
    by the phase ceiling never raises, so that handler never runs and the
    attribute stayed dark on exactly the scenario the MR exists for — 65
    batched calls, none returned, none failed. The ceiling needs its own span
    to be observable at all.
    """
    # Literal span name: the attribute sweep derives span coverage by reading
    # names out of the source, so an f-string here is invisible to it and would
    # make this span untracked. The phase goes on as an attribute instead.
    #
    # The two CONSTANTS are attached at entry, not after the call. The inner
    # helper raises on a failed batch and on an external cancel — and a kill is
    # a routine path, not an edge case — so attributes set afterwards would be
    # skipped on exactly the traces an operator opens to find out which phase
    # was interrupted. `timed_out` is set in the finally so it is present on the
    # success path too, as an explicit False rather than an absence.
    with background_span(
        "dataprep.llm.phase",
        attributes={
            ATTRIBUTE_NAMES["dataprep_llm_phase"]: phase_label,
            ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"]: DATAPREP_LLM_PHASE_TIMEOUT_SECONDS,
            ATTRIBUTE_NAMES["dataprep_llm_timed_out"]: False,
        },
    ) as span:
        results, timed_out = await _gather_with_phase_budget_inner(
            tasks,
            phase=phase,
            phase_label=phase_label,
            total=total,
            file_id=file_id,
            write_ingestion_log=write_ingestion_log,
        )
        span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], timed_out)
    return results, timed_out


async def _gather_with_phase_budget_inner(
    tasks: list, *, phase: str, phase_label: str, total: int, file_id: str, write_ingestion_log
) -> tuple[list, bool]:
    """Run *tasks* concurrently under a wall-clock bound, reporting progress.

    Returns ``(results, timed_out)``. On timeout the batches that already
    finished are returned, the rest are cancelled, and the caller maps
    ``timed_out`` onto whatever its phase falls back to.

    ``asyncio.gather`` cannot do this job. It carries no wall-clock bound of its
    own — each task is bounded only by its own client timeout and retry ladder,
    so on a contended endpoint the phase waits for its slowest task however long
    that task has been running. It also yields nothing until every task is done,
    which is what made a live ingest indistinguishable from a hung one: the
    progress log that would have shown movement sat *after* the gather and was
    never reached.

    Progress is reported on a timer rather than per completion. A completion
    counter floods the ingestion log on a fast phase (one line per batch, 65 for
    a 260-chunk document) while a slow phase still needs a heartbeat; a timer
    costs one line per interval whatever the throughput.
    """
    if not tasks:
        # False, not []: an empty list happens to be falsy so the callers behave,
        # but a list where the contract says bool makes every `if timed_out` read
        # as working by coincidence.
        return [], False

    started = time.monotonic()
    # Wrapped in submission order so a failed batch can be picked
    # deterministically: asyncio.wait hands back a set, and iterating one would
    # make "which exception aborts the ingest" depend on set ordering.
    ordered = [asyncio.ensure_future(t) for t in tasks]
    order = {id(task): n for n, task in enumerate(ordered)}
    pending = set(ordered)
    results: list = []
    interval = DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS
    next_report = started + interval
    # A task that raised, held until the in-flight set is settled. Re-raising it
    # has to happen AFTER the cancel-and-settle below, not at the point it was
    # noticed: raising first would leave every sibling task running, holding its
    # semaphore slot and its open HTTP connection until its own retry ladder
    # finished — so one bad batch would stall the fallback that was about to
    # run for it.
    failure: BaseException | None = None
    settle_interrupted = False
    abandoned = 0

    try:
        while pending:
            # Wait on whichever deadline comes first, so a progress tick is
            # never held behind the phase deadline. When the remaining budget is
            # the shorter of the two, this single wait IS the phase deadline —
            # which is why the reporting below forces a tick whenever
            # remaining_phase <= 0 rather than relying on the interval alone.
            remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

            settled = {t for t in pending if t.done()}
            pending -= settled
            if settled:
                done = settled
            else:
                # FIRST_COMPLETED is stated explicitly: on this interpreter the
                # implicit default over a task set does NOT return as soon as
                # one task finishes, it waits out the whole timeout. That would
                # make a phase whose first batch fails early sit idle until its
                # budget elapsed before surfacing the error — the exact stall
                # the bound exists to prevent, one error path later.
                done, pending = await asyncio.wait(
                    pending,
                    timeout=max(min(interval, remaining_phase), 0.01),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                # Recomputed, not carried over: the wait, and the heartbeat
                # write inside the branch below it, both consume wall clock, so
                # the value from before the wait understates how much of the
                # budget is gone. Using it to decide whether to report and
                # whether to break lets the phase overshoot its own deadline by
                # up to one tick, which is the difference between a bound and
                # an approximation of one.
                remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

            for task in sorted(done, key=lambda t: order[id(t)]):
                # Propagate a raised task exactly as gather would — but record it
                # and keep draining the loop first, so the settle-and-cancel in
                # the finally block runs before it escapes. Iterating the set
                # asyncio.wait returns would pick an arbitrary member, so which
                # of two differently-failing batches decides whether the ingest
                # aborts or degrades would change run to run.
                # cancelled() first: Task.exception() raises
                # CancelledError on a cancelled task, so one individually-
                # cancelled batch would otherwise turn the whole phase into a
                # CancelledError and the document would report "Killed" instead
                # of the failure it actually had.
                if task.cancelled():
                    continue
                exc = task.exception()
                if exc is not None:
                    if failure is None:
                        failure = exc
                    continue
                results.append(task.result())

            # Stop collecting once a batch has failed, the way gather would:
            # the phase is going to raise, so the remaining batches' results
            # would be discarded anyway and waiting for them only delays the
            # error by up to the whole budget. The finally block cancels them.
            if failure is not None:
                break

            # Report BEFORE the budget check. The wait ran for
            # min(interval, remaining_phase), so if the operator set an interval
            # at or above the budget the phase ends on this tick — and a check
            # placed after the break would leave the final tick unreported,
            # i.e. an operator who raised the interval to quiet a busy log
            # would get silence for the whole phase instead.
            now = time.monotonic()
            # Report when the reporting interval has elapsed OR the phase is
            # about to give up — the second clause is what keeps an interval
            # set above the budget from silencing the phase, since in that case
            # the single wait consumed the whole budget and the interval never
            # elapsed on its own.
            out_of_time = now >= next_report or remaining_phase <= 0
            if pending and out_of_time:
                next_report = now + interval
                message = (
                    f"{phase} in progress: {len(results)}/{total} batches completed, "
                    f"{len(pending)} in flight, {now - started:.0f}s elapsed "
                    f"(budget {DATAPREP_LLM_PHASE_TIMEOUT_SECONDS:g}s)"
                )
                logger.info(message)
                await _safe_log(write_ingestion_log, file_id, "INFO", phase, message)
                # Same reason as after the wait above: the write is a full
                # ingestion-log round trip, and on a slow backend it can be the
                # longest thing in the tick. Testing the deadline against the
                # value from before it lets the phase run another whole tick
                # past its budget.
                remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

                # The log write yields the event loop for a full ingestion-log
                # round trip. A batch that answers during it holds a complete
                # result, and discarding it would report the phase as having
                # lost work the LLM actually did — pointing the operator at GPU
                # contention instead of at the budget. Drain what settled.
                late = {t for t in pending if t.done()}
                pending -= late
                for task in sorted(late, key=lambda t: order[id(t)]):
                    # cancelled() first: Task.exception() raises CancelledError on
                    # a cancelled task, so an individually-cancelled batch would
                    # otherwise turn the whole phase into a CancelledError.
                    if task.cancelled():
                        continue
                    exc = task.exception()
                    if exc is not None:
                        if failure is None:
                            failure = exc
                        continue
                    results.append(task.result())

                if failure is not None:
                    # A failure seen here must end the loop exactly as one seen
                    # in the main drain does. Falling through would park the
                    # remaining batches in asyncio.wait for a whole progress
                    # interval before the finally cancels them — holding their
                    # semaphore slots and connections while the fallback that
                    # was about to run for the failed batch waits behind them.
                    break

            if not pending or remaining_phase <= 0:
                break

        # Tasks still in flight at the deadline — not a raised batch, the phase
        # simply outran its budget.
        abandoned = len(pending)
    finally:
        # Cancel whatever is still running, on the timeout path AND on the
        # error path, and give it a bounded window to notice.
        #
        # Cancelling is a REQUEST, not a guarantee: a coroutine that swallows
        # CancelledError, or that is parked in a non-cancellable await, keeps
        # its semaphore slot after this returns. That is bounded and safe for
        # the LLM phases — their awaits are cancellation-cooperative and each
        # attempt has a budget of its own, so an abandoned one finishes on its
        # own — but it means the phase can return `timed_out` while a straggler
        # is still writing. Do not read this block as "nothing runs after we
        # return"; read it as "nothing runs unbounded after we return".
        if pending:
            for task in pending:
                task.cancel()
            # Bounded settle. An unbounded gather here would make the phase
            # bound advisory: a task sitting in a non-cancellable await (a
            # thread offload, a client swallowing CancelledError) never
            # completes, so the gather never returns and the caller waits past
            # its budget anyway — the exact unbounded stall this helper exists
            # to end. Waiting briefly lets well-behaved tasks release their slot
            # and their connection; anything still stuck is abandoned, and the
            # caller gets its fallback.
            # Settle and retrieve together, shielded: a task that turned its
            # cancellation into a real exception — a client catching
            # CancelledError, or a typed failure raised between the last drain
            # and the cancel — would otherwise surface as "Task exception was
            # never retrieved" with a full traceback, noise landing in the
            # dataprep log during exactly the contended-GPU incidents this work
            # exists to make diagnosable. gather retrieved every child; this
            # restores that without giving up the bounded settle.
            settle_interrupted, absorbed_cancel = await _settle_and_retrieve(pending)

    if settle_interrupted and failure is None:
        # The settle absorbed a cancellation, and this path has no exception of
        # its own to re-raise — it was reached by the budget expiring or by the
        # drains finishing, not by anything propagating. Dropping the signal here
        # returns a normal (results, timed_out) tuple for an ingest the kill
        # endpoint has already reported as killed: the caller falls back, logs a
        # budget warning, and carries on writing the document.
        # Re-raise the object the cancellation actually delivered. A fresh
        # CancelledError would carry none of its identity, and an enclosing
        # asyncio.timeout that expires inside this window could not tell its own
        # expiry from a kill.
        raise absorbed_cancel

    if failure is not None:
        # A batch that raised is an error the phase's caller already knows how
        # to fall back from; swallowing it here would turn a visible failure
        # into a silently degraded document.
        #
        # An absorbed cancellation does not displace it, but it is not silent
        # either: without this the same situation logged a warning in
        # _await_with_heartbeat and vanished here, so an operator who cancelled
        # a failing phase saw "Ingestion Error" with no record that a kill had
        # been requested. The failure wins because it is the more specific
        # cause; the cancellation is recorded so the other is not lost.
        if settle_interrupted:
            logger.warning(
                f"{phase}: cancelled externally while settling a failed batch; "
                "reporting the batch failure, which is the more specific cause"
            )
        raise failure

    if abandoned:
        _dataprep_phase_budget_exhausted_total.add(1, {"phase": phase_label})
        # Seconds render with one decimal: an integer format renders a
        # sub-second budget as "0s", which reads as a misconfiguration rather
        # than the fast test deadline it is.
        message = (
            f"{phase} exceeded its {DATAPREP_LLM_PHASE_TIMEOUT_SECONDS:g}s budget after "
            f"{time.monotonic() - started:.1f}s: {len(results)}/{total} batches completed, "
            f"{abandoned} abandoned. Falling back for the remaining batches."
        )
        logger.warning(message)
        await _safe_log(write_ingestion_log, file_id, "WARN", phase, message)
        return results, True

    return results, False


async def _await_with_heartbeat(
    tasks: list, *, phase: str, total: int, file_id: str, write_ingestion_log
) -> list | None:
    """Wait for every task, reporting progress as they settle.

    The counterpart to ``_gather_with_phase_budget`` for a phase that has no
    fallback: it has the same reporting but no deadline, because the only way to
    bound a phase is to give up on part of it and this phase cannot lose work
    without losing documents. Errors propagate as ``asyncio.gather`` raises them
    (first failure wins), so the caller's existing error handling still applies.

    Every exit other than the success path takes the still-pending batches with
    it, by cancelling them and giving ``_PHASE_CANCEL_GRACE_SECONDS`` to settle.
    That matters because the caller retracts the document on every one of those
    exits: a batch still running writes into ArangoDB after ``retract_file`` has
    deleted it, resurrecting chunks for a document the admin UI shows as failed.

    Cancelling does not stop a batch already inside ``asyncio.to_thread`` — the
    thread runs to completion either way, and that race is pre-existing and
    documented at the call site. What it does stop is every batch still queued
    on ``MAX_CONCURRENT_BATCHES``, which for a large document is most of them:
    they have not reached the thread and would otherwise write the whole
    document after the retraction. So the grace window is a courtesy for batches
    that unwind promptly, not a licence to abandon the rest.
    """
    if not tasks:
        return

    started = time.monotonic()
    interval = DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS
    next_report = started + interval
    pending = set(tasks)
    # Submission order, for the same reason as the budgeted variant: the set
    # asyncio.wait returns has no order, and which failing batch decides the
    # ingest's outcome must not depend on it.
    order = {id(task): n for n, task in enumerate(tasks)}
    completed = 0
    failure: BaseException | None = None

    try:
        while pending:
            settled = {t for t in pending if t.done()}
            pending -= settled
            if not settled:
                done, pending = await asyncio.wait(pending, timeout=interval, return_when=asyncio.FIRST_COMPLETED)
                settled = done
            for task in sorted(settled, key=lambda t: order[id(t)]):
                # Re-raise the first failure, as gather would. Done before any
                # further reporting so the phase fails on the real error rather than
                # on the heartbeat's log write.
                # cancelled() first: Task.exception() raises
                # CancelledError on a cancelled task, so one individually-
                # cancelled batch would otherwise turn the whole phase into a
                # CancelledError and the document would report "Killed" instead
                # of the failure it actually had.
                if task.cancelled():
                    continue
                exc = task.exception()
                completed += 1
                if exc is not None and failure is None:
                    failure = exc

            if failure is not None:
                # Cancelled and settled, like every other non-success exit here.
                # The caller retracts the document the moment this raises, so a
                # sibling left running writes into ArangoDB after the retraction
                # and resurrects its chunks for a document the admin UI shows as
                # failed. Batches already inside asyncio.to_thread are unaffected
                # either way — that thread runs to completion whatever we do — so
                # what cancelling actually stops is every batch still queued on
                # the semaphore, which for a large document is most of them.
                #
                # _settle_and_retrieve absorbs a cancellation that arrives during
                # the window: the settle is what was promised, it has a timeout of
                # its own, and losing it to a second cancel would hand the caller
                # exactly the abandoned-batch outcome described above.
                for task in pending:
                    task.cancel()
                interrupted, _absorbed = await _settle_and_retrieve(pending)
                if interrupted:
                    # An external cancellation during the settle does not replace
                    # the failure. The document is retracted either way, but the
                    # kill switch would report "Killed by an administrator" and
                    # the ArangoDB error underneath — the one thing the operator
                    # needs — would never reach the ingestion log.
                    logger.warning(
                        f"{phase}: cancelled externally while settling a failed batch; "
                        "reporting the batch failure, which is the more specific cause"
                    )
                raise failure

            now = time.monotonic()
            if pending and now >= next_report:
                next_report = now + interval
                message = (
                    f"{phase} in progress: {completed}/{total} batches completed, "
                    f"{len(pending)} in flight, {now - started:.0f}s elapsed"
                )
                logger.info(message)
                await _safe_log(write_ingestion_log, file_id, "INFO", phase, message)

    except asyncio.CancelledError:
        # Every exit other than the success path has to take the still-pending
        # batches with it, because the caller is retracted either way.
        # asyncio.gather, which this helper replaced, did that implicitly by
        # cancelling its children; a bare `while pending` loop does not, so an
        # external cancellation — ingest_file_with_guardrail's kill switch, or
        # a service shutdown — propagated straight out and left every queued
        # graph batch running. They were parked on the semaphore at that point,
        # so they would acquire it and write the whole document to ArangoDB
        # AFTER retract_file() had already deleted it: chunks resurrected for a
        # document the admin UI shows as Killed, and served to the retriever.
        for task in pending:
            task.cancel()
        _, _absorbed = await _settle_and_retrieve(pending)
        raise

    # Success path (merge 2026-10-21): every task has settled, so their results
    # are handed back for the caller's insertion accounting — the empty-graph
    # refusal must not regress under the heartbeat. Callers that ignore the
    # return are unaffected.
    return [t.result() for t in tasks]


@OpeaComponentRegistry.register("GENIE_DATAPREP_ARANGODB")
class GenieArangoDataprep(OpeaArangoDataprep):
    """
    GENIE.AI Extension of OpeaArangoDataprep.
    Adds: Docling, Multi-Strategy Labeling, Guardrails, Batched Ingestion, and Repo Callbacks.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, description, config)
        # FIX: Increased Semaphore from 5 to 100 to restore ingestion speed.
        # The backend rate limit is now disabled, so we can send logs much faster.
        self._log_semaphore = asyncio.Semaphore(100)
        # Story 4.8-amend (David's 4th-time directive, 2026-08-20): per-instance
        # caches that map (concept_id → bundle_file_id) and (concept_id →
        # concept_file_name) so every per-stage log POST can mirror into the
        # bundle zip's ingestion_log (file-centric UI) without re-querying
        # doc-repo for every chunk. The cache is populated lazily on the first
        # log write that targets a concept id; the resolution is best-effort
        # (any failure → no mirror, primary log still succeeds).
        self._bundle_file_id_cache: dict[str, str] = {}
        self._concept_file_name_cache: dict[str, str] = {}

        # Debug Requirement 2: Print environment at startup
        self._log_environment_variables()

    def _concept_file_name(self, file_id: str) -> str | None:
        """Return the concept's original filename for use as a log prefix so
        the bundle's UI Ingestion Log tab is traceable. Pulled from the
        ``input.file_name`` (Story 4.8-amend follow-up) on first use; cached."""
        # Parallel-ingest: the request-local context is authoritative when the
        # task bound one; the legacy self-cache stays as the fallback.
        ctx = _INGEST_CTX.get()
        if ctx is not None:
            cache = ctx["name_cache"]
            if file_id in cache:
                return cache[file_id] or None
            file_name = getattr(ctx["input"], "file_name", None)
            cache[file_id] = file_name or ""
            return file_name or None
        cached = self._concept_file_name_cache.get(file_id)
        if cached is not None:
            return cached or None
        # The file_id IS the concept_id; the request body carries the original
        # filename under input.file_name. The microservice populates this from
        # the worker's POST (which sets fileName: <concept>.md). For non-OKF
        # single-file paths, input.file_name mirrors the upload's filename.
        # We lazily capture it on the first label_log call.
        try:
            file_name = getattr(self._current_input, "file_name", None)
        except AttributeError:
            file_name = None
        if file_name:
            self._concept_file_name_cache[file_id] = file_name
        else:
            self._concept_file_name_cache[file_id] = ""
        return file_name or None

    async def _bundle_log_url(self, session, file_id: str, headers: dict) -> str | None:
        """Resolve the doc-repo URL that mirrors an ingestion log into the
        bundle zip's ingestion_log (file-centric UI). Returns None when no
        bundle exists for the current repo or the doc-repo query fails."""
        # Cache hit — POSITIVE results only are cached. Review P1a (live-caught
        # v13b): the old code permanently cached "" on ANY failure (transient
        # doc-repo hiccup, bundle row not yet queryable) with no retry — the
        # first concept dispatched could lose its ENTIRE mirrored log history
        # for the run while its siblings logged every stage. Failures are now
        # retried on the next log write (the lookup is one cheap GET).
        cached = self._bundle_file_id_cache.get(file_id)
        if cached:
            return f"{DOCUMENT_REPOSITORY_URL}/api/files/{cached}/ingestion-log"
        # Parallel-ingest: request-local cache/repo when the task bound a
        # context (falls through to the legacy self-state otherwise).
        ctx = _INGEST_CTX.get()
        if ctx is not None:
            if file_id in ctx["bundle_cache"]:
                return f"{DOCUMENT_REPOSITORY_URL}/api/files/{ctx['bundle_cache'][file_id]}/ingestion-log"
            if not (file_id and self._is_concept_id(file_id)):
                return None
            repo_id = ctx["repo_id"]
        else:
            if not (file_id and self._is_concept_id(file_id)):
                return None
            repo_id = getattr(self, "_current_repo_id", None)
        if not repo_id:
            return None
        # Look up the bundle zip via doc-repo's getFiles (Story 4.8-amend +
        # ce9d825 supports repo_id + is_bundle=true filters).
        try:
            url = f"{DOCUMENT_REPOSITORY_URL}/api/files?repo_id={repo_id}&is_bundle=true&limit=1"
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(
                    total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
                ),
            ) as r:
                if r.status != 200:
                    return None  # transient — retried on the next write
                data = await r.json()
                items = (
                    data.get("data")
                    if isinstance(data, dict) and "data" in data
                    else (data if isinstance(data, list) else [])
                )
                if not items:
                    return None  # bundle not yet queryable — retried (P1a race)
                bundle_file_id = items[0].get("file_id")
                if not bundle_file_id:
                    return None
                if ctx is not None:
                    ctx["bundle_cache"][file_id] = bundle_file_id
                else:
                    self._bundle_file_id_cache[file_id] = bundle_file_id
                return f"{DOCUMENT_REPOSITORY_URL}/api/files/{bundle_file_id}/ingestion-log"
        except Exception as e:
            if logflag:
                logger.warning(f"Bundle-log URL resolve failed for concept {file_id}: {e}")
            return None  # transient — NOT cached (P1a)

    # Invariant: a value is a doc-repo file_id only when it matches the
    # TIMESTAMP SHAPE of doc-repo ids — ``${Date.now()}_${uuidv4().split('-')[0]}``
    # (components/document-repository/src/utils/fileUtils.js), e.g.
    # '1774623200119_e9887fa8'. The old first-char-digit check misclassified
    # concept ids that BEGIN with a digit ('3d_printing_guide') as file_ids,
    # silently skipping their bundle-log mirror (review 2026-10-29 round 3).
    _FILE_ID_SHAPE_RE = re.compile(r"^\d+_[0-9a-f]{8,}$")

    def _is_concept_id(self, value: str) -> bool:
        """Heuristic: an OKF concept id is a bare id (e.g.
        'ecitizen_digital_payments', 'index', '3d_printing_guide'); a doc-repo
        file_id matches the timestamped shape above. Anything matching that
        shape is treated as a file_id (no mirror); every other value —
        including digit-leading bare ids — is a concept id (mirror)."""
        if not value:
            return False
        return not self._FILE_ID_SHAPE_RE.match(value)

    def _initialize_client(self):
        """Override the OPEA parent's DB selection with the GENIE convention.

        The parent reads the module-level ``ARANGO_DB_NAME`` (default ``_system``);
        GENIE uses ``ARANGO_DB`` (default ``genie-ai``) so dataprep and retriever
        target the SAME database for RAG retrieval. This replaces the former
        import-time ``_parent_mod.ARANGO_DB_NAME = ...`` monkeypatch (Story 1.4
        pre-rebase cleanup) with a subclass override — no module mutation.

        The parent's own defaults are preserved for the connection params it
        reads: ``ARANGO_URL`` (``http://localhost:8529``), ``ARANGO_USERNAME``
        (``root``), ``ARANGO_PASSWORD`` (``test``). Only the DB name follows the
        GENIE convention (``ARANGO_DB`` → ``ARANGO_DB_NAME`` → ``genie-ai``),
        matching the retriever's default so both target the same database.
        """
        with background_span("dataprep.initialize_client"):
            # GENIE convention: ARANGO_DB wins, falls back to ARANGO_DB_NAME,
            # then genie-ai (same default as the retriever).
            db_name = os.getenv("ARANGO_DB", os.getenv("ARANGO_DB_NAME", "genie-ai"))

            import arango

            self.client = arango.ArangoClient(hosts=os.getenv("ARANGO_URL", "http://localhost:8529"))
            sys_db = self.client.db(
                name="_system",
                username=os.getenv("ARANGO_USERNAME", os.getenv("ARANGO_USER", "root")),
                password=os.getenv("ARANGO_PASSWORD", "test"),
                verify=True,
            )

            if not sys_db.has_database(db_name):
                sys_db.create_database(db_name)

            self.db = self.client.db(
                name=db_name,
                username=os.getenv("ARANGO_USERNAME", os.getenv("ARANGO_USER", "root")),
                password=os.getenv("ARANGO_PASSWORD", "test"),
                verify=True,
            )

    def _log_environment_variables(self):
        """Debug: Print all critical environment variables at startup."""
        with background_span("dataprep.log_environment_variables"):
            logger.debug(
                f"GENIE-AI DATAPREP CONFIGURATION: "
                f"DOC_REPO={DOCUMENT_REPOSITORY_URL}, "
                f"BACKEND={BACKEND_SERVICE_URL}, "
                f"GUARDRAIL={GUARDRAIL_ENABLED} ({GUARDRAIL_URL}), "
                f"LABELING={LABELING_STRATEGY}, "
                f"EMBED_THRESHOLD={EMBEDDING_LABEL_THRESHOLD}, "
                f"BM25_THRESHOLD={BM25_LABEL_THRESHOLD}, "
                f"EXTRACTION={CONTENT_EXTRACTION_METHOD}, "
                f"LLM={os.getenv('VLLM_ENDPOINT')}, "
                f"ARANGO_DB={os.getenv('ARANGO_DB')}, "
                f"PROMPT_LEN={len(LABEL_SELECTOR_SYSTEM_PROMPT)}, "
                f"BATCHES={MAX_CONCURRENT_BATCHES}, "
                f"CONTEXTUAL_RETRIEVAL={CONTEXTUAL_RETRIEVAL_ENABLED}"
            )

    def _initialize_llm(self, *args, **kwargs):
        """Override parent: explicit VLLM_MODEL_ID env wins, else discover.

        The parent reads VLLM_MODEL_ID from env/constant: the explicit env
        wins untouched; when it is unset, the id discovered at VLLM_ENDPOINT
        (TTL-cached, see core/model_cache.py — loud when nothing answers) is
        written into os.environ AND the parent module constant before calling
        the parent method.
        """
        _vllm_endpoint = os.getenv("VLLM_ENDPOINT", "")

        detected = resolve_model_id(_vllm_endpoint)
        if detected != os.getenv("VLLM_MODEL_ID"):
            # Discovered (the env did not answer): mirror it into os.environ
            # AND the parent module constant (captured at parent import time —
            # os.environ alone does not update it). The parent reads
            # VLLM_MODEL_ID as a module constant, so this reassignment is
            # the runtime mechanism for model discovery.
            os.environ["VLLM_MODEL_ID"] = detected
            _parent_mod.VLLM_MODEL_ID = detected
            logger.info(f"Auto-discovered vLLM model for graph extraction: {detected}")

        super()._initialize_llm(*args, **kwargs)

    # --- Utilities (Spec 4.1, 5.2, 6.1) ---

    async def _service_headers(self):
        """Return auth headers using Keycloak service account Bearer token."""
        try:
            token = await get_service_account_token()
            return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        except Exception as e:
            logger.error(f"Failed to obtain service account token: {e}")
            return None

    async def _update_doc_status(
        self,
        file_id: str,
        status: str,
        chunk_count: int = None,
        concept_id: str = None,
        error: str = None,
        okf_graph_hint: bool | None = None,
    ):
        """Updates file status. For an OKF CONCEPT (concept_id set — content-only
        chunking, no doc-repo files doc), the completion callback routes to the OKF
        Server, which owns the concept's index_status. Otherwise (legacy single-file
        ingest), it routes to the Document Repository as before (Spec 4.1/6.1).
        ``error``: the failure reason, carried on 'Ingestion Error' callbacks so the
        row's last_error names the CAUSE (failure-clarity, David 2026-09-09 — a
        generic wrapper left the user blind to what went wrong).
        ``okf_graph_hint``: caller-supplied routing for calls outside any ingest
        context (the retract path) — True/False routes by the request's own OKF_
        graph marker; left as None the legacy singleton fallback applies."""
        headers = await self._service_headers()
        if not headers:
            if logflag:
                logger.warning(f"Skipping status update for {file_id} due to missing auth token.")
            return

        ctx = _INGEST_CTX.get()
        # Request-local context WINS when bound: falling back to the shared
        # mutable attribute from a bound context let a concurrent OKF ingest's
        # repo_id leak into a legacy ingest's completion routing
        # (DATAPREP_INGEST_CONCURRENCY > 1 — review 2026-10-29). The ctx now
        # carries okf_graph_hint alongside repo_id (bound at ingest start, the
        # same single per-request source) so an OKF_-graph ingest WITHOUT a
        # repo_id still routes to the OKF control plane instead of being
        # hardcoded to the legacy route (review round 2, thread e0e879eb).
        if ctx is not None:
            current_repo = ctx.get("repo_id")
            okf_graph_hint = bool(ctx.get("okf_graph_hint", False))
        elif okf_graph_hint is not None:
            # Caller-supplied routing (retract path, review 2026-10-29 round
            # 3): route by the request's own OKF_ graph marker. The singleton
            # fallback below may hold a CONCURRENT ingest's repo under
            # DATAPREP_INGEST_CONCURRENCY > 1, and a retract carries no
            # repo_id of its own (a graph name is a name, not an identity
            # field), so none is claimed.
            current_repo = None
        else:
            current_repo = getattr(self, "_current_repo_id", None)
            okf_graph_hint = getattr(self, "_current_okf_graph_hint", False)
        # 2026-10-10 (live, 6× ERROR during the Slaugherhouse ingest): a call
        # site that lost concept_id still carried a CONCEPT id as file_id —
        # the fallthrough PATCHed doc-repo, which rightly has no metadata for
        # concept ids ("Metadata not found"), poisoning every log sweep. An
        # OKF ingest (ctx has repo_id, or the input carried an OKF_ graph)
        # routes to the OKF control plane EVEN when concept_id is missing —
        # the endpoint resolves by file_id.
        is_okf_job = bool(concept_id or current_repo or okf_graph_hint)
        if is_okf_job:
            # Story 4.8-amend: OKF concept completion → okf-server concept-status
            # endpoint (the control plane that owns index_status + edges).
            url = f"{OKF_SERVER_URL}/api/okf/internal/concepts/{concept_id or file_id}/status"
            payload = {"file_id": file_id, "status": status}
            if chunk_count is not None:
                payload["chunk_count"] = chunk_count
            if error:
                payload["error"] = str(error)[:500]
            # Exact-lookup key: the same concept_id can exist in multiple repos
            # (clones, smoke scratch repos); the okf-server resolves repo from
            # this when present instead of an ambiguous repo-wide search.
            if current_repo:
                payload["repo_id"] = current_repo
            # Internal cross-service auth: the shared secret (fail-closed — an
            # unconfigured okf-server refuses every callback). From the env so
            # it is never hardcoded.
            headers = dict(headers or {})
            headers["X-OKF-Internal-Secret"] = os.getenv("OKF_INTERNAL_SECRET", "")
        else:
            url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/status"
            # FIX: chunk_count must be at the ROOT level, not inside dataprep object
            payload = {"dataprep": {"status": status}}
            if chunk_count is not None:
                payload["chunk_count"] = chunk_count

        # 3 attempts with backoff (review 2026-10-15): this PATCH is the ONLY
        # channel that flips a meta row to 'indexed' — a single lost call
        # discards the whole ~30-min ingest and the worker re-bills it in full.
        # Timeout reads the shared HTTP policy (main's model_http_policy) so the
        # connect ceiling stays explicit — bounding an aiohttp call with
        # ClientTimeout(total=...) alone REMOVES the 30s sock_connect default.
        for attempt in range(1, 4):
            try:
                propagate.inject(headers)
                async with (
                    self._log_semaphore,
                    aiohttp.ClientSession(
                        timeout=aiohttp.ClientTimeout(
                            total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
                        )
                    ) as session,
                    session.patch(url, json=payload, headers=headers) as response,
                ):
                    if response.status == 200:
                        return
                    # Invariant: only the documented success status ends the
                    # loop. A non-200 (5xx/429 hiccup) used to `return` here —
                    # only connection errors ever retried — so one transient
                    # gateway failure discarded the whole ~30-min ingest: the
                    # row never reached 'indexed' and the worker re-billed it
                    # in full (review 2026-10-29 round 3). Fall through and
                    # retry like any other failure.
                    logger.error(
                        f"Failed to update status {status} for {file_id} "
                        f"(attempt {attempt}/3): HTTP {response.status}: {await response.text()}"
                    )
            except Exception as e:
                logger.error(f"Error calling status API (attempt {attempt}/3) for {file_id}: {e}")
            if attempt < 3:
                await asyncio.sleep(min(2 ** (attempt - 1), 8))

    async def _write_ingestion_log(self, file_id: str, level: str, stage: str, message: str):
        """Writes human-readable logs to the Document Repository (Spec 5.2/6.2).

        Story 4.8-amend (David's directive): for content-only chunking there is
        no per-concept files doc — the primary write keys on the concept_id
        (file_id), and EVERY entry is ALSO mirrored to the bundle zip's
        ingestion_log (resolved from the ingest repo) with a
        ``[<concept_file_name>]`` prefix so the bundle's UI Ingestion Log tab
        shows the complete per-stage lifecycle (System/Chunking/
        Contextualization/Labeling/Graph) exactly like a single-file ingest.
        The mirror is best-effort and never fails the primary write.
        """
        headers = await self._service_headers()
        if not headers:
            if logflag:
                logger.warning(f"Skipping log write for {file_id} due to missing auth token.")
            return

        payload = {"level": level, "stage": stage, "message": message}
        propagate.inject(headers)
        primary_url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/ingestion-log"
        try:
            async with (
                self._log_semaphore,
                aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(
                        total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
                    )
                ) as session,
            ):
                # --- primary write (concept_id-keyed) ---
                try:
                    async with session.post(primary_url, json=payload, headers=headers) as response:
                        if response.status == 429:
                            if logflag:
                                logger.warning("Log write rate-limited (429). Dropping log message.")
                        elif response.status != 201:
                            logger.warning(f"Log write for {file_id} failed: HTTP {response.status}")
                except Exception as e:
                    logger.warning(f"Log write for {file_id} failed: {e}")

                # --- bundle mirror (every stage; prefixed with the concept file name) ---
                try:
                    mirror_url = await self._bundle_log_url(session, file_id, headers)
                    if mirror_url:
                        name = self._concept_file_name(file_id)
                        mirror_payload = dict(payload)
                        mirror_payload["message"] = f"[{name or file_id}] {message}"
                        async with session.post(mirror_url, json=mirror_payload, headers=headers) as mr:
                            if mr.status != 201 and logflag:
                                logger.warning(f"Bundle-log mirror for {file_id} failed: HTTP {mr.status}")
                except Exception as e:
                    logger.warning(f"Bundle-log mirror for {file_id} failed: {e}")
        except Exception as e:
            logger.error(f"Error calling Doc Repo Log API: {e}")

    async def _fetch_all_labels(self):
        """Fetch full taxonomy from the Backend Service to guide the LLM."""
        headers = await self._service_headers()
        if not headers:
            logger.warning("Skipping label fetch due to missing service account token.")
            return []

        # FIX: Target the Backend Service for the hierarchy
        url = f"{BACKEND_SERVICE_URL}/api/service-categories/categories"

        try:
            propagate.inject(headers)
            async with (
                self._log_semaphore,
                aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(
                        total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
                    )
                ) as session,
                session.get(url, headers=headers) as response,
            ):
                if response.status == 200:
                    data = await response.json()
                    # Backend returns a tree structure (Category -> Children).
                    # A name is a translation: null or empty means the
                    # translation is missing, a content problem. Anything else
                    # the parser does not recognise means the dataprep and the
                    # backend do not agree on the payload, a contract problem.
                    # The two have different remedies, so they are counted
                    # apart.
                    groups: list[tuple[str, list[str]]] = []
                    untranslated = 0
                    malformed = 0
                    if isinstance(data, list):
                        for category in data:
                            if not isinstance(category, dict):
                                malformed += 1
                                continue
                            # A category the payload does not name keeps a
                            # group of its own: its services are not filed
                            # under the name of the category that precedes
                            # them. The name is set below, when the payload
                            # carries one.
                            group_name = ""
                            # The EN translation is the vocabulary every
                            # chunk_label is minted from. The localized name
                            # only happens to BE English while the fetch
                            # carries no locale parameter — a tree older than
                            # the both-spellings contract publishes no nameEN,
                            # and its `name` at the default locale IS the
                            # English translation, so it is the fallback.
                            label = category.get("nameEN") or category.get("name")
                            if "name" not in category and "nameEN" not in category:
                                malformed += 1
                            elif isinstance(label, str) and label:
                                group_name = label
                            elif label is None or label == "":
                                # A category whose translation is missing
                                # arrives as null: it has no label to offer,
                                # and its services are kept under a nameless
                                # group.
                                untranslated += 1
                            else:
                                malformed += 1
                            # All Children (Services)
                            services: list[str] = []
                            children = category.get("children")
                            if isinstance(children, list):
                                for child in children:
                                    # Children might be strings or objects depending on query
                                    label = ""
                                    if isinstance(child, dict):
                                        if "name" not in child and "nameEN" not in child:
                                            malformed += 1
                                            continue
                                        # The EN spelling first — same rule as
                                        # the category above.
                                        label = child.get("nameEN") or child.get("name")
                                    elif isinstance(child, str) or child is None:
                                        # The backend returns null for a service
                                        # whose translation is missing.
                                        label = child or ""
                                    else:
                                        malformed += 1
                                        continue
                                    if isinstance(label, str) and label:
                                        services.append(label)
                                    elif label is None or label == "":
                                        untranslated += 1
                                    else:
                                        malformed += 1
                            groups.append((group_name, services))
                    else:
                        # A 200 response whose body is not the taxonomy tree at
                        # all: every entry is unparseable, and reporting zero
                        # drops would point the operator at translations rather
                        # than at the contract.
                        malformed += 1

                    ordered_labels = _canonical_taxonomy_order(groups)
                    # The counts are in the per-fetch line: the taxonomy is
                    # fetched once per document, and a missing translation is
                    # a standing condition — a warning per document would
                    # fill the log with the same line. A taxonomy that reads
                    # as complete while a service is missing from it is worse
                    # than a noisy log, so the counts are always stated.
                    logger.info(
                        f"Taxonomy: {len(ordered_labels)} unique labels for labelling, "
                        f"{untranslated} without a usable label (missing translation), "
                        f"{malformed} malformed entries in the payload."
                    )
                    return ordered_labels

                logger.error(f"Label fetch failed. Status: {response.status}, Body: {await response.text()}")
        except Exception as e:
            logger.error(f"Error fetching labels from Backend: {e}")
        return []

    # --- Core Pipeline Steps ---

    async def _load_and_chunk(self, doc_path: DocPath) -> list[str]:
        path = doc_path.path

        # --- FIX: Expanded Docling Support ---
        # Added .docx, .pptx, .xlsx, .md, .txt, .html support
        docling_extensions = (".pdf", ".docx", ".pptx", ".xlsx", ".html", ".txt", ".md", ".asciidoc")

        if path.endswith(docling_extensions) and CONTENT_EXTRACTION_METHOD == "docling":
            logger.info(f"Using Docling for file: {path}")
            content = await docling_document_loader(path)
        else:
            logger.info(f"Using Standard Loader for file: {path}")
            content = await document_loader(path)

        if not content:
            return []

        if path.endswith(".html"):
            text_splitter = HTMLHeaderTextSplitter(headers_to_split_on=[("h1", "H1"), ("h2", "H2")])
        elif path.endswith(".md"):
            # Section-aware markdown chunking: split on H1-H4 headers, then cap
            # each section at chunk_size with intra-section overlap. The
            # section path is prepended to each chunk so the LLM labeler (and
            # any downstream retrieval) sees the heading context.
            md_splitter = MarkdownHeaderTextSplitter(
                headers_to_split_on=[
                    ("#", "Header 1"),
                    ("##", "Header 2"),
                    ("###", "Header 3"),
                    ("####", "Header 4"),
                ],
                strip_headers=True,
            )
            char_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

            def _split_md(text: str) -> list[str]:
                if not text:
                    return []
                md_docs = md_splitter.split_text(text)
                docs = char_splitter.split_documents(md_docs)
                out = []
                for d in docs:
                    # Filter to str values: add_start_index on the char splitter
                    # injects an int offset into Document.metadata, which would
                    # crash a naive " > ".join(...) prefix.
                    header_parts = [v for v in d.metadata.values() if isinstance(v, str)]
                    path_label = " > ".join(header_parts) if header_parts else ""
                    if path_label:
                        out.append(f"## {path_label}\n\n{d.page_content}")
                    else:
                        out.append(d.page_content)
                return out

            with tracer.start_as_current_span("dataprep.chunking") as span:
                if isinstance(content, list):
                    plain_chunks = []
                    for item in content:
                        plain_chunks.extend(_split_md(str(item)))
                else:
                    plain_chunks = _split_md(content)
                valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
                span.set_attribute("dataprep.chunk_count", len(valid_chunks))
            return valid_chunks
        else:
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

        with tracer.start_as_current_span("dataprep.chunking") as span:
            if isinstance(content, list):
                raw_chunks = []
                for item in content:
                    item_str = str(item)
                    if len(item_str) > doc_path.chunk_size:
                        raw_chunks.extend(text_splitter.split_text(item_str))
                    else:
                        raw_chunks.append(item_str)
                plain_chunks = raw_chunks
            else:
                docs = text_splitter.create_documents([content])
                plain_chunks = [d.page_content for d in docs]

            valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
            span.set_attribute("dataprep.chunk_count", len(valid_chunks))

        return valid_chunks

    async def _run_guardrail(self, plain_chunks: list[str]) -> dict[str, Any]:
        if not GUARDRAIL_ENABLED:
            return {"success": True}

        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(
                total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
            )
        ) as session:
            for i, text in enumerate(plain_chunks):
                try:
                    async with session.post(GUARDRAIL_URL, json={"text": text}) as resp:
                        if resp.status != 200:
                            return {"success": False, "message": f"Guardrail error chunk {i}"}

                        result = await resp.json()
                        if result.get("text") != text:
                            return {"success": False, "message": f"Chunk {i}: Blocked by guardrail.", "chunk_index": i}
                except Exception as e:
                    return {"success": False, "message": f"Guardrail connection failed: {e}"}

        return {"success": True}

    # --- Labeling Strategies (Spec 5.3, 5.4) ---

    async def _label_with_llm(self, chunks: list[str], all_labels: list[str], file_labels: list[str], file_id: str):
        """Label chunks with the LLM, falling back to the document's own labels.

        Returns ``(results, reasons)``. ``results`` is one
        ``{"text", "labels"}`` per input chunk, in order. ``reasons`` lists
        human-readable causes, empty when labelling completed, and it is what
        stops the document being reported as plainly Ingested — see
        DEGRADED_REMEDIES for why a list rather than a flag.
        """
        # Guarded exactly as _apply_contextualization guards it, and for the same
        # reason. Contextualization runs first, so an unbuildable client is caught
        # there, recorded as a degradation, and the ingest carries on to labelling —
        # where the same call would raise, land in the ingest's except handler, and
        # retract a document that has a perfectly good file-label fallback. Which
        # of the two phases is reached first must not decide whether the ingest
        # survives a misconfigured endpoint.
        #
        # Falls through to the same tail the per-batch fallback uses rather than
        # returning early: that tail resolves each chunk's labels against the
        # taxonomy, so a client-less run produces the same result as a batch that
        # failed, instead of a second, subtly different labelling path.
        degraded: list[str] = []
        client = model = None
        try:
            # Off the event loop, like the contextualization path: the model-id
            # probe inside is a sync HTTP call that can take its whole timeout
            # when the endpoint does not answer, and a frozen loop stalls
            # every concurrent request this process serves.
            client, model = await asyncio.to_thread(_build_vllm_client)
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:200]}"
            logger.error(f"LLM labeling disabled for {file_id}: vLLM client init failed ({err}); using file labels.")
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Labeling",
                f"vLLM client init failed ({err}); using file labels.",
            )
            degraded.append(f"{DEGRADED_CLIENT_UNAVAILABLE} ({err})")
            # The metric covers the per-batch AND the whole-phase paths; a whole
            # phase that never reached the model is the larger of the two and
            # was counted nowhere.
            _llm_fallback_total.add(len(chunks), {"phase": PHASE_LABEL_LABELING, "reason": "client_unavailable"})

        # Enumerated once, above the client check: the batch split below and the
        # fallback tail below both read it, and the tail runs whether or not a
        # client was ever built. Computing it inside the branch left the second
        # read rebinding the same value, which is a rename waiting to diverge.
        indexed = list(enumerate(chunks))
        partials: list = []
        timed_out = False
        if client is not None:
            # Precompute the system prompt once (the taxonomy is identical for every chunk).
            system_prompt = LABEL_SELECTOR_SYSTEM_PROMPT.replace("{labels_list}", str(all_labels))
            logger.debug(
                f"LLM LABELING INPUTS: taxonomy ({len(all_labels)} labels), "
                f"file_labels: {file_labels}, system_prompt ({len(system_prompt)} chars), "
                f"chunks: {len(chunks)}, batch_size: {LABEL_LLM_BATCH_SIZE}, "
                f"concurrency: {MAX_CONCURRENT_BATCHES}"
            )

            semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
            logger.info(
                f"LLM labeling: {len(chunks)} chunks "
                f"(concurrency={MAX_CONCURRENT_BATCHES}, batch_size={LABEL_LLM_BATCH_SIZE}, "
                f"model={model}, temperature={LLM_LABEL_TEMPERATURE})"
            )

            # Group indexed chunks into batches; each batch yields one LLM call (or,
            # on parse failure, per-chunk calls). All gated by the semaphore.
            batches = [indexed[i : i + LABEL_LLM_BATCH_SIZE] for i in range(0, len(indexed), LABEL_LLM_BATCH_SIZE)]

            async def _process_batch(batch):
                async with semaphore:
                    return await self._llm_suggest_labels(client, model, system_prompt, batch, file_id, file_labels)

            partials, timed_out = await _gather_with_phase_budget(
                [_process_batch(b) for b in batches],
                phase="LLM labeling",
                phase_label=PHASE_LABEL_LABELING,
                total=len(batches),
                file_id=file_id,
                write_ingestion_log=self._write_ingestion_log,
            )

            if timed_out:
                abandoned = len(batches) - len(partials)
                _llm_fallback_total.add(abandoned, {"phase": PHASE_LABEL_LABELING, "reason": "phase_budget"})
                # Recorded here, where the cause is known, so the file-label
                # fallback below can see that the phase degraded as a whole.
                degraded.append(DEGRADED_PHASE_BUDGET)

            fell_back = sum(f for _, f in partials)
            # Every chunk answered by the document's own labels rather than the
            # model: the endpoint is unreachable, or it is a model that rejects
            # response_format=json_object, or a model id that resolves to nothing
            # usable. Every chunk landed, so nothing looks broken, and without
            # this the document reports a clean Ingested on a labelling phase
            # that never ran. The contextual phase reports its equivalent
            # (DEGRADED_NO_CONTEXTS); this is the labelling twin.
            #
            # All-or-nothing only. Some chunks falling back is what the per-batch
            # fallback is for, and flagging the document for it would make the
            # status fire on healthy documents.
            if chunks and fell_back == len(chunks):
                degraded.append(f"{DEGRADED_NO_LABELS} (0/{len(chunks)})")

        suggested_map: dict[int, list[str]] = {}
        for partial, _fell_back in partials:
            suggested_map.update(partial)

        # An abandoned batch contributes NOTHING — it was cancelled before
        # reaching the per-chunk loop, so the file-label fallback at the end of
        # _llm_suggest_labels never runs for its chunks. Left unfilled they are
        # stored with an empty label list: unreachable by taxonomy, and the
        # ingestion log reads "Final labels (0): []" for them, which looks like
        # a labelling regression rather than the budget exhaustion it is.
        #
        # A client that never built is the same shape one step earlier: no chunk
        # reaches the LLM at all, so every one of them would land unlabelled.
        # Both are wholesale failures of the phase rather than a per-batch miss,
        # so both fall back to the document's own labels — which is what a batch
        # that failed rather than timed out ends up with, so a degraded document
        # is uniform. Scoped to those two on purpose: a chunk the LLM
        # legitimately returned nothing for is not force-labelled.
        if degraded and file_labels:
            for i, _ in indexed:
                suggested_map.setdefault(i, list(file_labels))

        # Resolve suggestions against the taxonomy (exact + synonym match) and
        # emit a single consolidated ingestion-log entry per chunk.
        results = []
        total = len(indexed)
        for n, (i, text) in enumerate(indexed, 1):
            labels = await self._finalize_chunk_labels(i, suggested_map.get(i, []), all_labels, file_id, file_labels)
            results.append({"text": text, "labels": labels})
            if n % 200 == 0 or n == total:
                logger.info(f"Labeling progress: {n}/{total} chunks finalized")
        return results, degraded

    @staticmethod
    def _doc_context_truncation(chunks: list[str], budget: int) -> dict | None:
        """Describe a doc-context truncation, or ``None`` when nothing was cut.

        Split out of :meth:`_build_doc_context` for ONE reason: the builder is
        sync and ``_write_ingestion_log`` is async, so the async caller cannot
        reach the log from inside the builder. Until now the truncation was
        ``logger.warning`` only — unlike every other degradation path in this
        file (client-init failure, the zero-context guard) it never reached the
        admin Ingestion Log, which is why a corpus-wide truncation went
        unnoticed. The caller uses this to emit the same facts there.
        """
        joined_len = sum(len(c) for c in chunks) + max(0, len(chunks) - 1)
        if budget <= 0 or joined_len <= budget:
            return None
        return {
            "kept": budget,
            "total": joined_len,
            "pct": (budget * 100 // joined_len) if joined_len else 0,
            "chunks": len(chunks),
        }

    @staticmethod
    def _is_default_budget(configured: int, single_call: bool) -> bool:
        """True when the configured budget is still the shipped default.

        A default is not a deliberate setting: on a deployment whose window
        is unknown it must not be sent as-is (the doc_level default of
        100000 chars is ~25k tokens, more than a small window holds).
        """
        default = DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL if single_call else DATAPREP_CONTEXTUAL_DOC_BUDGET
        return configured == default

    def _resolve_doc_budget(
        self,
        chunks: list[str],
        configured: int,
        window: int,
        *,
        scaffold_chars: int,
        authoritative: bool = True,
        single_call: bool = False,
    ) -> tuple[int | None, str]:
        """Resolve the document-context budget for this document.

        Returns ``(budget_chars, source)``. ``budget_chars is None`` means
        "do not contextualize this document at all" and the caller must fall
        back to raw chunks. ``source`` is one of:

            "override"        operator set DATAPREP_CONTEXTUAL_DOC_BUDGET
            "derived"         computed from the given serving-model window
            "window-capped"   the operator's budget, capped by the window
            "disabled"        operator set a negative budget
            "window-exhausted" the model window cannot fit any context

        The prompt the context LLM receives is the system prompt + the document
        context + the batch's chunk text, and the response reserves
        DATAPREP_CONTEXTUAL_MAX_TOKENS. Only the middle term is ours to size,
        so everything else is subtracted from ``window`` — the serving model's
        context window, which the caller obtains from _serving_model_window
        (runtime discovery) and passes in. It is a parameter rather than a
        lookup here because that discovery probe is a blocking HTTP call:
        resolving it inside this function would freeze the event loop on the
        ingest path.

        ``single_call`` is the doc_level strategy: ONE call per document, so
        the request carries the system prompt (with the document context
        embedded in it) and reserves ONE output budget — no chunk text.

        An explicit budget is a MAXIMUM, not a pin: when the window is
        known (``authoritative`` — discovered, or stated by the operator),
        a budget that does not fit it is capped, because a request the model
        cannot accept is rejected and the batch falls back to raw chunks
        silently.

        When the window is only the fail-closed GUESS, a DELIBERATE operator
        setting stands (nobody knows the real window there, so capping
        against a guess would destroy it) — but a knob still at its shipped
        default does not: the doc_level default of 100000 chars is ~25k
        tokens, more than a small window holds, so it is capped like a
        derived budget and the deployment fails closed.

        The document-context scaffolding (filename line, labels line, header,
        truncation marker, user turn) sits outside the budget and is
        reserved separately — a request sized without it overflows the
        window by exactly those characters. ``scaffold_chars`` is that
        scaffolding MEASURED for this document (the filename and the labels
        are unbounded), and the batch term is the length of the serialized
        user turn, which is what the request actually sends.

        The batch term is measured from the REAL chunks rather than from the
        DATAPREP_CHUNK_SIZE_* vars: those are resolved per file extension
        upstream in the microservice, and mirroring that map here would be a
        second copy to drift — which is how this whole budget went wrong in
        the first place.
        """
        if configured < 0:
            return None, "disabled"
        if configured > 0 and not authoritative and not self._is_default_budget(configured, single_call):
            # The window is only the fail-closed GUESS, and the operator
            # stated this budget DELIBERATELY: a guess may neither cap nor
            # refuse it. Only a window somebody knows can overrule one.
            return configured, "override"

        if single_call:
            prompt_tokens = -(-len(_CONTEXTUAL_DOC_PROMPT_DEFAULT) // CHARS_PER_TOKEN)
            batch_tokens = 0
            output_tokens = CONTEXTUAL_MAX_TOKENS
        else:
            prompt_tokens = -(-len(CONTEXTUAL_RETRIEVAL_PROMPT) // CHARS_PER_TOKEN)
            # The TEXTS of the largest chunks, not their lengths: the
            # reservation is the serialized user turn, so it has to serialize
            # the text that is sent.
            largest = sorted(chunks, key=len, reverse=True)[:LABEL_LLM_BATCH_SIZE]
            # The user turn is json.dumps([{"index": i, "text": t}, ...]) — the raw
            # chunk text plus per-item JSON scaffolding AND the escaping of
            # every non-ASCII character. Reserve the SERIALIZED length, which
            # is what the request sends: a non-ASCII document needs a third
            # more room than its raw text suggests, and under-reserving sends
            # a request the model cannot accept.
            batch_chars = _batch_user_turn_chars(largest)
            batch_tokens = -(-batch_chars // CHARS_PER_TOKEN)
            # The batched per-chunk path reserves ONE CONTEXTUAL_MAX_TOKENS per chunk
            # in the batch (max_tokens=CONTEXTUAL_MAX_TOKENS * len(batch)) — the
            # response holds a context per chunk — so this scales with the batch
            # size, it is not a flat cap. Reserving less would size the budget
            # against a request the model would never actually complete.
            output_tokens = CONTEXTUAL_MAX_TOKENS * LABEL_LLM_BATCH_SIZE
        if single_call:
            scaffold_chars += len(DOC_LEVEL_USER_TURN)
        scaffold_tokens = -(-scaffold_chars // CHARS_PER_TOKEN)
        usable = window - prompt_tokens - batch_tokens - output_tokens - scaffold_tokens
        if usable <= 0:
            # NOT "budget 0" — in _build_doc_context a budget of 0 means "do
            # not truncate", i.e. send the whole document, which is precisely
            # what would overflow. Skip contextualization for this document.
            logger.error(
                f"Contextual Retrieval: the {window}-token serving-model window leaves no room for "
                f"a document context (system prompt {prompt_tokens} + batch text {batch_tokens} + "
                f"output {output_tokens} tokens). Using raw chunks for this document; lower "
                f"DATAPREP_LLM_LABEL_BATCH_SIZE (currently {LABEL_LLM_BATCH_SIZE}) or "
                f"DATAPREP_CONTEXTUAL_MAX_TOKENS (currently {CONTEXTUAL_MAX_TOKENS}), or serve a "
                f"larger window (vLLM --max-model-len)."
            )
            return None, "window-exhausted"
        derived = usable * CHARS_PER_TOKEN
        if configured > 0:
            if configured > derived:
                # The window is the binding constraint: say so, so the operator
                # does not read their own number back as the applied budget.
                return derived, "window-capped"
            return configured, "override"
        return derived, "derived"

    def _build_doc_context(self, chunks: list[str], input, budget: int = 0) -> str:
        """Build the document-context string fed to the context-generation LLM.

        Combines filename, file labels, and a budgeted join of the document's
        chunks. ``budget`` lets the doc_level path pass a larger window (it is a
        single call); per_chunk uses the smaller default (it is repeated per
        batch). Logs a WARN when the content is truncated so operators notice.
        """
        filename = os.path.basename(getattr(input, "storage_path", "") or getattr(input, "file_path", "") or "")
        file_labels = list(getattr(input, "file_labels", []) or [])
        joined = "\n".join(chunks)
        truncation = self._doc_context_truncation(chunks, budget)
        if truncation is not None:
            joined = joined[:budget] + DOC_CONTEXT_TRUNCATION_MARKER
        parts = []
        if filename:
            parts.append(f"Filename: {filename}")
        if file_labels:
            parts.append(f"Document labels: {', '.join(file_labels)}")
        parts.append(f"{DOC_CONTEXT_HEADER}{joined}")
        if truncation is not None:
            logger.warning(
                f"Contextual Retrieval: document context truncated to {truncation['kept']} chars "
                f"({truncation['pct']}% of {truncation['total']} chars, full doc "
                f"{truncation['chunks']} chunks). Deep chunks may get weaker context; "
                f"raise the budget (or use Map-Reduce for very large docs)."
            )
        return "\n".join(parts)

    async def _apply_contextualization(self, chunks: list[str], input, file_id: str) -> tuple[list[str], list[str]]:
        """Prepend an LLM-generated document context to each chunk.

        No-op when CONTEXTUAL_RETRIEVAL_ENABLED is false (returns chunks
        unchanged). When enabled, returns ``(contextualized_texts, reasons)``
        — the texts in the same order and length, of the form
        ``<context>\\n\\n<chunk>``. Chunks whose context generation fails fall
        back to the raw chunk so ingestion never blocks.

        ``reasons`` lists human-readable causes, empty when the phase completed,
        and it is what stops the document being reported as plainly Ingested. A
        list rather than a flag because the causes have DIFFERENT REMEDIES: an
        expired phase budget is fixed by raising the budget, a vLLM client that
        will not build is fixed by fixing the endpoint. Telling an operator to
        raise a budget for the second sends them to the wrong knob, with no
        error anywhere to tell them otherwise.
        """
        if not CONTEXTUAL_RETRIEVAL_ENABLED or not chunks:
            return list(chunks), []

        # Build the client outside the per-chunk retry loop. If construction fails
        # (e.g. model auto-detection failure on the GPU node), skip contextualization
        # entirely and ingest raw chunks — never block ingestion (spec boundary).
        try:
            client, default_model, serving_window, authoritative = await asyncio.to_thread(
                _build_vllm_client_and_window
            )
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:200]}"
            logger.error(
                f"Contextual Retrieval disabled for {file_id}: vLLM client init failed ({err}); using raw chunks."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                f"vLLM client init failed ({err}); using raw chunks.",
            )
            return list(chunks), [f"{DEGRADED_CLIENT_UNAVAILABLE} ({err})"]

        model = DATAPREP_CONTEXTUAL_MODEL.strip() or default_model
        total = len(chunks)

        async def _doc_context_or_none(
            chunks_: list[str], configured: int, label: str, *, single_call: bool = False
        ) -> str | None:
            """Resolve the budget, log any truncation, build the context.

            Returns ``(context, skip_reason)`` — ``context is None`` when this
            document must not be contextualized at all (budget disabled, or the
            model window cannot fit any context); the caller then falls back to
            raw chunks, which is the documented never-block-ingestion boundary.
            ``skip_reason`` carries a DEGRADED_* reason only for the
            window-exhausted case — an operator-disabled budget is a deliberate
            configuration and reports nothing, but a window that cannot fit the
            context is a quality loss the document status must carry.

            Truncation is a silent quality loss unless it is recorded: the chunk
            embedding and the graph extraction both read the *contextualized*
            text, so a truncated context degrades both while nothing fails and
            ingestion still reports success. Routing it through
            ``_write_ingestion_log`` is what makes it visible to a curator
            instead of only to whoever greps container logs.
            """
            budget, source = self._resolve_doc_budget(
                chunks_,
                configured,
                serving_window,
                scaffold_chars=_doc_context_scaffold_chars(input),
                authoritative=authoritative,
                single_call=single_call,
            )
            if budget is None:
                return None, (DEGRADED_WINDOW_TOO_SMALL if source == "window-exhausted" else None)

            truncation = self._doc_context_truncation(chunks_, budget)
            if truncation is not None:
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Contextualization",
                    (
                        f"Document context truncated to {truncation['kept']} of "
                        f"{truncation['total']} chars ({truncation['pct']}%, budget {label}/{source}) "
                        f"across {truncation['chunks']} chunks. Deep chunks get a weaker "
                        f"document context, which degrades their embedding and the "
                        f"graph extraction. "
                        + (
                            "The served window is what binds here: raise it on the GPU "
                            "(vLLM --max-model-len). Raising the budget alone changes nothing — "
                            "the model rejects a request larger than the window it serves."
                            if source == "window-capped"
                            else (
                                "Raise DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL"
                                if label == "doc_level"
                                else "Raise DATAPREP_CONTEXTUAL_DOC_BUDGET"
                            )
                            + " if the model window allows."
                        )
                        + " Or split the document during curation."
                    ),
                )
            return self._build_doc_context(chunks_, input, budget), None

        # doc_level: one LLM call for the whole document → same context on every
        # chunk (uses a larger doc budget — it is a single call; N× cheaper).
        if CONTEXTUAL_STRATEGY == "doc_level":
            doc_context, skip_reason = await _doc_context_or_none(
                chunks, DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL, "doc_level", single_call=True
            )
            if doc_context is None:
                # An operator-disabled budget is deliberate (no reason); a window
                # that cannot fit the context is a degradation the status carries.
                return list(chunks), ([skip_reason] if skip_reason else [])
            texts, generated = await self._contextualize_doc_level(client, model, doc_context, chunks, file_id, total)
            # One call for the document, so there is no batch wave to exhaust a
            # budget over — but that is not the same as "cannot degrade". A single
            # call that returns nothing usable is the all-or-nothing case, exactly
            # as a per_chunk phase where no chunk got a context, and it must name
            # itself or doc_level deployments report every fully-uncontextualized
            # document as a clean ingest.
            return texts, [] if generated else [f"{DEGRADED_NO_CONTEXTS} (0/{total})"]

        # per_chunk (default): batched calls so the document context lives once
        # per batch (system prompt), not per chunk; per-chunk fallback on any
        # batch parse failure (Anthropic recipe).
        doc_context, skip_reason = await _doc_context_or_none(chunks, DATAPREP_CONTEXTUAL_DOC_BUDGET, "per_chunk")
        if doc_context is None:
            # An operator-disabled budget is deliberate (no reason); a window
            # that cannot fit the context is a degradation the status carries.
            return list(chunks), ([skip_reason] if skip_reason else [])
        system_prompt = CONTEXTUAL_RETRIEVAL_PROMPT.replace("{document_context}", doc_context)
        return await self._contextualize_per_chunk(client, model, system_prompt, chunks, file_id, total)

    async def _contextualize_per_chunk(
        self, client, model, system_prompt, chunks, file_id, total
    ) -> tuple[list[str], list[str]]:
        """per_chunk strategy: batched LLM calls → one section-tailored context per chunk.

        Chunks are batched (``LABEL_LLM_BATCH_SIZE``) so the document context is
        sent once per batch (system prompt), not per chunk; concurrency is
        bounded by ``MAX_CONCURRENT_BATCHES``. Any batch parse failure falls back
        to per-chunk calls; chunks whose context fails fall back to raw text.
        """
        logger.info(
            f"Contextual Retrieval (per_chunk): {total} chunks "
            f"(batch_size={LABEL_LLM_BATCH_SIZE}, concurrency={MAX_CONCURRENT_BATCHES}, model={model})"
        )
        indexed = list(enumerate(chunks))
        batches = [indexed[i : i + LABEL_LLM_BATCH_SIZE] for i in range(0, len(indexed), LABEL_LLM_BATCH_SIZE)]
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)

        async def _process_batch(batch):
            async with semaphore:
                return await self._context_batch_call(client, model, system_prompt, batch, file_id)

        partial_contexts, timed_out = await _gather_with_phase_budget(
            [_process_batch(b) for b in batches],
            phase="Contextual Retrieval",
            phase_label=PHASE_LABEL_CONTEXTUAL,
            total=len(batches),
            file_id=file_id,
            write_ingestion_log=self._write_ingestion_log,
        )
        if timed_out:
            _llm_fallback_total.add(
                len(batches) - len(partial_contexts), {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "phase_budget"}
            )

        contexts: dict[int, str] = {}
        for partial in partial_contexts:
            contexts.update(partial)

        result = []
        with_context = 0
        for i, chunk in indexed:
            ctx = (contexts.get(i, "") or "").strip()
            if ctx:
                with_context += 1
                result.append(f"{ctx}\n\n{chunk}")
            else:
                result.append(chunk)

        if with_context == 0:
            # Silent-degradation guard: a misconfigured DATAPREP_CONTEXTUAL_MODEL
            # (e.g. one that rejects response_format=json_object) makes every chunk
            # fall back with no error — surface one loud signal so operators notice.
            logger.error(
                f"Contextual Retrieval produced 0/{total} contexts for {file_id} — "
                f"likely {model} does not support guided JSON or is unreachable. "
                f"Check DATAPREP_CONTEXTUAL_MODEL / VLLM_ENDPOINT."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                f"0/{total} contexts generated — verify the model supports guided JSON and is reachable.",
            )
        else:
            raw_count = total - with_context
            # Final post-recovery count: with_context chunks have a non-empty context
            # (batched or recovered via per-chunk calls). The remaining raw_count
            # chunks fell back to raw text because BOTH the batch parse AND the
            # per-chunk recovery returned empty (after 3 retries each). This is NOT
            # the per-batch "missing" count — partials are already recovered here.
            logger.info(
                f"Contextual Retrieval: {with_context}/{total} chunks contextualized "
                f"({raw_count} using raw text after batch + per-chunk recovery failed)."
            )
        # Both a stalled phase and a phase that produced nothing are degradations,
        # and they have different fixes — so both are named. Reporting only the
        # budget case meant an endpoint that answers but returns nothing usable
        # (a model without guided JSON, say) logged a loud ERROR and then left
        # the document reading "Ingested", which is precisely the silent shortfall
        # this status exists to make visible.
        #
        # Mutually exclusive, budget first: an exhausted phase produced no contexts
        # *because* its batches were abandoned, so naming both would tell the
        # operator to check their model supports guided JSON when the ceiling is
        # what stopped it — the wrong knob, on top of the right one.
        #
        # Only the all-or-nothing case is a cause. A handful of chunks out of
        # hundreds falling back is normal operation — it is what the per-batch
        # fallback is for — and flagging the document for it would make the
        # status fire on healthy documents and train operators to ignore it.
        if timed_out:
            return result, [DEGRADED_PHASE_BUDGET]
        if with_context == 0:
            return result, [f"{DEGRADED_NO_CONTEXTS} (0/{total})"]
        return result, []

    async def _context_batch_call(self, client, model, system_prompt, batch, file_id) -> dict[int, str]:
        """One LLM call generating contexts for a batch of chunks.

        Returns ``{chunk_index: context}``. On a parse failure the whole batch
        falls back to per-chunk ``_context_single_call``. On a PARTIAL response
        (the LLM returned some but not all chunk contexts — common with
        temperature-sampled models that skip entries nondeterministically),
        the missing chunk indices are recovered via per-chunk calls so no chunk
        silently degrades to raw text. Emits a ``dataprep.llm.context_batch``
        span (per-chunk spans on fallback).
        """
        valid_ids = {i for i, _ in batch}
        if len(batch) > 1:
            with background_span(
                "dataprep.llm.context_batch",
                attributes={
                    "dataprep.llm_batched": True,
                    "dataprep.llm_batch_size": len(batch),
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                    "dataprep.contextual_strategy": "per_chunk",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {
                                "role": "user",
                                "content": json.dumps([{"index": i, "text": t} for i, t in batch]),
                            },
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=CONTEXTUAL_MAX_TOKENS * len(batch),
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    raw = parsed.get("contexts", parsed) if isinstance(parsed, dict) else {}
                    out: dict[int, str] = {}
                    for k, v in raw.items():
                        try:
                            idx = int(k)
                        except (TypeError, ValueError):
                            continue
                        if idx in valid_ids and isinstance(v, str) and v.strip():
                            out[idx] = v.strip()
                    if out:
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.contexts_generated", len(out))
                        # Recover any chunks the LLM omitted (partial response).
                        # Without this, missing indices silently degrade to raw
                        # text — the batch "succeeded" so no fallback fired, but
                        # some chunks lost their context. Recover them explicitly.
                        missing = [i for i in valid_ids if i not in out]
                        if missing:
                            span.set_attribute("dataprep.partial_recovery_count", len(missing))
                            await self._write_ingestion_log(
                                file_id,
                                "INFO",
                                "Contextualization",
                                f"Batch returned {len(out)}/{len(batch)} contexts; "
                                f"recovering missing chunks {sorted(missing)} via per-chunk calls.",
                            )
                            for i in missing:
                                text = next(t for idx, t in batch if idx == i)
                                out[i] = await self._context_single_call(client, model, system_prompt, i, text, file_id)
                        return out
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Batch context parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                    )
                    _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "batch_parse"})
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    if _is_vllm_input_overflow(e):
                        # Bali regression (2026-10-16): a Cyrillic-heavy fragment
                        # tokenized at ~1.75 chars/token against the derivation's
                        # CHARS_PER_TOKEN=4 estimate, the batch call 400'd by ONE
                        # token — and the raise that used to live here killed the
                        # WHOLE ingest (0 chunks persisted, concept terminal-failed),
                        # breaking the "never blocks ingestion" contract. The term
                        # that overflowed is usually the batch's N x
                        # CONTEXTUAL_MAX_TOKENS output reservation; a per-chunk call
                        # reserves 512 instead of N x 512 and fits. Degrade, never
                        # fail the ingest: the context is optional enrichment, the
                        # raw chunks are the payload.
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_batch"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"Batch context vLLM context overflow ({err}); retrying per-chunk "
                            f"(512-token output reservation fits where the batch's N x 512 did not).",
                        )
                    else:
                        logger.warning(
                            f"Batch context failed {[i for i, _ in batch]}: {err}; falling back to per-chunk."
                        )
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"Batch context failed ({err}); falling back to per-chunk.",
                        )
                        if _is_timeout(e):
                            with suppress(Exception):
                                span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                                span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "batch_error"})
        # per-chunk fallback (single-chunk batch, parse failure, or call error)
        fallback: dict[int, str] = {}
        for i, text in batch:
            fallback[i] = await self._context_single_call(client, model, system_prompt, i, text, file_id)
        return fallback

    async def _contextualize_doc_level(
        self, client, model, doc_context, chunks, file_id, total
    ) -> tuple[list[str], bool]:
        """doc_level strategy: one LLM call → one document context prepended to every chunk.

        Returns ``(texts, generated)``. ``generated`` is False when the single
        call produced nothing usable, which is the doc_level equivalent of a
        per_chunk phase where no chunk got a context — the caller needs it to
        report the degradation rather than infer it from the text.
        """
        system_prompt = _CONTEXTUAL_DOC_PROMPT_DEFAULT.replace("{document_context}", doc_context)
        logger.info(f"Contextual Retrieval (doc_level): 1 call for {total} chunks (model={model}).")
        summary = (await self._context_doc_call(client, model, system_prompt, file_id) or "").strip()
        if not summary:
            logger.error(
                f"Contextual Retrieval (doc_level) produced no context for {file_id} — "
                f"check DATAPREP_CONTEXTUAL_MODEL / VLLM_ENDPOINT."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                "0 doc-level contexts generated — verify the model supports guided JSON and is reachable.",
            )
            return list(chunks), False
        logger.info(f"Contextual Retrieval (doc_level): context generated, prepending to {total} chunks.")
        return [f"{summary}\n\n{chunk}" for chunk in chunks], True

    async def _context_doc_call(self, client, model, system_prompt, file_id: str) -> str:
        """One LLM call generating a single document-level context (3 retries).

        Returns the context string, or "" if all attempts fail (caller falls
        back to raw chunks). Emits a ``dataprep.llm.context_doc`` span.
        """
        for attempt in range(1, 4):
            with background_span(
                "dataprep.llm.context_doc",
                attributes={
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                    "dataprep.contextual_strategy": "doc_level",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": "Write the document-level context."},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=CONTEXTUAL_MAX_TOKENS,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    # A body with no "context" key is not an answer saying the
                    # chunk needs no context — it is a body in a shape we never
                    # asked for, which is what a model ignoring
                    # response_format=json_object produces. `parsed.get("context",
                    # "")` made the two indistinguishable and then logged "empty
                    # context", a statement about the model that is simply false.
                    if not isinstance(parsed, dict) or "context" not in parsed:
                        shape = type(parsed).__name__ if not isinstance(parsed, dict) else "object without 'context'"
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"{'Doc-level'}: LLM returned a {shape}, not "
                            '{"context": "..."}. Retrying '
                            f"({attempt}/3)...",
                        )
                        continue
                    ctx = parsed["context"]
                    if isinstance(ctx, str) and ctx.strip():
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.context_chars", len(ctx))
                        return ctx.strip()
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Doc-level context empty (attempt {attempt}/3).",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    if _is_vllm_input_overflow(e):
                        # Deterministic 400 — no retry. The caller treats "" as
                        # "use raw chunks for this document" (Bali regression
                        # 2026-10-16 — see _context_batch_call).
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_doc"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"Doc-level context vLLM context overflow ({err}); using raw chunks.",
                        )
                        return ""
                    logger.warning(f"Doc-level context attempt {attempt}/3 failed: {err}")
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Doc-level context attempt {attempt}/3 failed: {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "WARN",
            "Contextualization",
            "Doc-level context generation failed after 3 attempts — using raw chunks.",
        )
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "doc_level_raw"})
        return ""

    async def _context_single_call(self, client, model, system_prompt, index: int, text: str, file_id: str) -> str:
        """One LLM call generating the context for a single chunk (3 retries).

        Returns the context string, or "" if all attempts fail (caller falls
        back to the raw chunk). Emits a ``dataprep.llm.context_chunk`` span.
        """
        for attempt in range(1, 4):
            if attempt > 1:
                # Backoff between retries — see _llm_call_single (review 2026-10-15).
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
            with background_span(
                "dataprep.llm.context_chunk",
                attributes={
                    "dataprep.chunk_index": index,
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"CHUNK:\n{text}"},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=CONTEXTUAL_MAX_TOKENS,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    # A body with no "context" key is not an answer saying the
                    # chunk needs no context — it is a body in a shape we never
                    # asked for, which is what a model ignoring
                    # response_format=json_object produces. `parsed.get("context",
                    # "")` made the two indistinguishable and then logged "empty
                    # context", a statement about the model that is simply false.
                    if not isinstance(parsed, dict) or "context" not in parsed:
                        shape = type(parsed).__name__ if not isinstance(parsed, dict) else "object without 'context'"
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"{f'Chunk {index}'}: LLM returned a {shape}, not "
                            '{"context": "..."}. Retrying '
                            f"({attempt}/3)...",
                        )
                        continue
                    ctx = parsed["context"]
                    if isinstance(ctx, str) and ctx.strip():
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.context_chars", len(ctx))
                        return ctx.strip()
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Chunk {index}: empty context (attempt {attempt}/3).",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    if _is_vllm_input_overflow(e):
                        # Deterministic 400 — retrying the same prompt is wasted
                        # calls. When the doc context alone exceeds the window the
                        # raw chunk is the correct degradation, not a failed
                        # ingest (Bali regression 2026-10-16 — see
                        # _context_batch_call).
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_single"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Contextualization",
                            f"Chunk {index}: context vLLM context overflow ({err}); using raw chunk.",
                        )
                        return ""
                    logger.warning(f"Chunk {index}: context attempt {attempt}/3 failed: {err}")
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Chunk {index}: context attempt {attempt}/3 failed: {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "WARN",
            "Contextualization",
            f"Chunk {index}: context generation failed after 3 attempts — using raw chunk.",
        )
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "raw_chunk"})
        return ""

    async def _llm_suggest_labels(
        self, client, model, system_prompt, batch, file_id, file_labels
    ) -> tuple[dict[int, list[str]], int]:
        """Return ``(suggestions, fell_back)`` for one batch.

        ``suggestions`` maps chunk index to raw suggested labels. Uses a single
        batched LLM call when ``len(batch) > 1``; any parse failure falls back to
        one call per chunk so labeling always completes.

        ``fell_back`` counts the chunks whose labels came from the document's own
        scope because the model did not answer, NOT the ones the model answered
        with an empty list. The two are indistinguishable in ``suggestions`` —
        a chunk the model genuinely found no matching label for and a chunk
        whose call failed three times both arrive as ``[]`` or as the file's
        labels — and only the second one is a degradation. The caller needs the
        distinction to tell a total labelling failure from a document that
        legitimately matched nothing.
        """
        if len(batch) > 1:
            try:
                result = await self._llm_call_batch(client, model, system_prompt, batch, file_id)
                if result is not None:
                    suggestions, missing = result
                    if not missing:
                        return suggestions, 0
                    # Keep what the model DID answer and re-ask only the rest.
                    # Falling through to the per-chunk path below would re-ask
                    # every chunk in the batch, spending a second call on each
                    # one already labelled by the call we just made.
                    out = dict(suggestions)
                    fell_back = 0
                    by_index = dict(batch)
                    for i in missing:
                        labels, used_file_labels = await self._llm_call_single(
                            client, model, system_prompt, i, by_index[i], file_id, file_labels
                        )
                        out[i] = labels
                        fell_back += used_file_labels
                    return out, fell_back
                # _llm_call_batch already counted the failure (parse or call) —
                # it swallows both and returns None, so nothing reaches the
                # handlers below for a failed call.
                # Wording is a published contract: this substring is listed in
                # site/content/en/docs/operate/ingestion-log.md as one of the
                # "canonical messages you will grep for", with the guided-JSON
                # remedy attached. Renaming it here silently breaks the
                # runbook, so the doc moves with the string, not the reverse.
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                )
            except DataprepInputTooLongError:
                # Fail-loud: batch prompt is structurally too long; retrying with
                # the same oversized prompt in the per-chunk fallback would either
                # (a) succeed only if the per-chunk prompt is small enough (rare)
                # or (b) call vLLM with the same identical oversized text and fail
                # again — wasting a batch call + 0..N per-chunk calls. Skip the
                # batch-level retry path entirely; the per-chunk call sites will
                # raise the same typed exception cleanly when they hit the cap.
                raise
            except Exception as e:
                # Reached only for a failure _llm_call_batch did not handle —
                # it is the last resort before per-chunk, not the common path.
                # No counter here on purpose: _llm_call_batch swallows every
                # failure it sees and returns None, so this handler only runs
                # for an exception raised outside its own try, and a counter
                # there would report a permanently-zero label that reads as
                # "no batch errors ever happen".
                err = f"{type(e).__name__}: {str(e)[:200]}"
                batch_indices = [i for i, _ in batch]
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {batch_indices} ({err}); falling back to per-chunk.",
                )
        # Per-chunk path (default, and batch fallback for transient/non-overflow errors).
        out: dict[int, list[str]] = {}
        fell_back = 0
        for i, text in batch:
            labels, used_file_labels = await self._llm_call_single(
                client, model, system_prompt, i, text, file_id, file_labels
            )
            out[i] = labels
            fell_back += used_file_labels
        return out, fell_back

    async def _llm_call_single(
        self, client, model, system_prompt, index, text, file_id, file_labels
    ) -> tuple[list[str], bool]:
        """One LLM call for a single chunk with up to 3 retries. Emits an OTel span.

        Returns ``(labels, fell_back)``. ``fell_back`` is True only when the
        model did not answer and the document's own labels were substituted —
        not when the model answered that the chunk matches nothing, which is a
        correct answer and not a degradation.
        """
        for attempt in range(1, 4):
            if attempt > 1:
                # Backoff between retries: 3 immediate attempts against a struggling
                # gateway deepen its queue instead of recovering (review 2026-10-15).
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
            with background_span(
                "dataprep.llm.label_chunk",
                attributes={
                    "dataprep.chunk_index": index,
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Input: {text}"},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=160,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    # A body with no "labels" key is not an answer saying "no match" —
                    # it is a body in a shape we did not ask for, which is what a model
                    # ignoring response_format=json_object produces. `parsed.get("labels", [])`
                    # made the two indistinguishable: the key missing became an empty list,
                    # so the call counted as ANSWERED, fell_back stayed False, and a document
                    # with every chunk unlabelled reported a clean Ingested. An explicit
                    # {"labels": []} is a real answer and still takes the path below.
                    if not isinstance(parsed, dict) or "labels" not in parsed:
                        shape = type(parsed).__name__ if not isinstance(parsed, dict) else "object without 'labels'"
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Labeling",
                            f"Chunk {index}: LLM returned a {shape}, not "
                            '{"labels": [...]}. Retrying '
                            f"({attempt}/3)...",
                        )
                        continue
                    suggested = parsed["labels"]
                    # Lenient: null -> []; a bare string -> [string]; drop non-strings.
                    if suggested is None:
                        suggested = []
                    elif isinstance(suggested, str):
                        suggested = [suggested]
                    if isinstance(suggested, list):
                        suggested = [x for x in suggested if isinstance(x, str)]
                        span.set_attribute("dataprep.labels_suggested", len(suggested))
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        return suggested, False
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Chunk {index}: LLM returned non-string labels {suggested}. Retrying ({attempt}/3)...",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    # Fail-loud on vLLM context overflow: the prompt is structurally too
                    # long; retrying with the identical oversized prompt would yield the
                    # same 400. Raise the typed exception so the ingest task records the
                    # failure via _write_ingestion_log (admin /api/admin/ingestion-log
                    # channel) instead of silently ingesting a degraded chunk.
                    if _is_vllm_input_overflow(e):
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "llm_call_single"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "ERROR",
                            "Labeling",
                            f"Chunk {index}: vLLM context overflow ({err}). "
                            f"Prompt exceeds model max_model_len; aborting this chunk.",
                        )
                        raise DataprepInputTooLongError(f"vLLM context overflow on chunk {index}: {err}") from e
                    logger.warning(f"Chunk {index}: LLM label attempt {attempt}/3 failed: {err}")
                    # Transient (will retry): WARN — the retry ladder recovers
                    # these when the shared LLM gateway flaps. The TERMINAL
                    # failure below is the ERROR (David, 2026-09-15: a chunk
                    # that permanently lost LLM labeling must not log at the
                    # same level as a self-healed retry).
                    # A timeout is the failure this deck is budgeted against, and
                    # the one that says nothing useful unless it is labelled:
                    # the span otherwise closes with no tokens, no duration
                    # reason and no status, which is indistinguishable from a
                    # call that is still in flight.
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Chunk {index}: transient LLM failure — retrying (attempt {attempt}/3): {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "ERROR",
            "Labeling",
            f"Chunk {index}: LLM failed to return valid labels after 3 attempts — "
            "chunk falls back to file labels only (no LLM labeling for this chunk).",
        )
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "file_labels"})
        return (list(file_labels) if file_labels else []), True

    async def _llm_call_batch(self, client, model, system_prompt, batch, file_id):
        """One LLM call labeling a whole batch of chunks.

        Returns ``(suggestions, missing)`` where ``missing`` lists the requested
        indices the response never mentioned, or ``None`` when the response
        cannot be used as a batch answer AT ALL — malformed JSON, not an object,
        or a failed call.

        The two are different failures with different costs. ``None`` throws the
        whole call away, so the caller re-asks every chunk. An incomplete answer
        is mostly good: the model labelled N-1 of N chunks, and re-asking all N
        discards N-1 answers it already paid for. On a contended GPU — exactly
        where the batch call is slowest and a drop most likely — that turns a
        2-call batch into 5 calls each carrying its own retry ladder, holding the
        same semaphore slot for the lot, which is more than the phase ceiling is
        sized for. So an incomplete answer is returned, not discarded, and only
        the missing indices are re-asked.

        An index present with an unusable VALUE is neither case — it becomes []
        in place, without re-asking, which is what the model means by it.
        """
        indices = [i for i, _ in batch]
        user_content = (
            "For each numbered chunk below, assign labels. Respond with ONLY a JSON object "
            "mapping EVERY chunk index (string key) to an ARRAY of label strings, e.g. "
            '{"0": ["Healthcare"], "1": ["Education"]}. Every index MUST be present; values '
            "are ALWAYS arrays (never null, never a bare string); use [] for chunks with no "
            "matching label. No prose, no markdown.\n"
        )
        for i, text in batch:
            user_content += f"\n[{i}] {text}"
        with background_span(
            "dataprep.llm.label_batch",
            attributes={
                "dataprep.llm_batched": True,
                "dataprep.llm_batch_size": len(batch),
                "dataprep.llm_model": model or "",
                # A native OTel array, not str(indices): the vocabulary requires
                # flat scalar sequences to be emitted as arrays, and the string
                # form ("[0, 3, 7]") carries separators that read as prose to the
                # span privacy sweep.
                "dataprep.chunk_indices": indices,
            },
        ) as span:
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    temperature=LLM_LABEL_TEMPERATURE,
                    max_tokens=len(batch) * 256 + 512,
                    response_format={"type": "json_object"},
                )
                parsed = json.loads(response.choices[0].message.content)
                if not isinstance(parsed, dict):
                    _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "batch_parse"})
                    return None
                index_set = set(indices)
                suggestions: dict[int, list[str]] = {}
                # Which indices the response MENTIONED, tracked apart from which
                # it managed to give a usable value for. The two used to be the
                # same set, so an index the model never mentioned and one it
                # mentioned with an unusable value both ended up as [] filed
                # under "the model chose not to label them".
                mentioned: set[int] = set()
                for key, labels in parsed.items():
                    try:
                        idx = int(key)
                    except (TypeError, ValueError):
                        continue
                    if idx not in index_set:
                        continue
                    mentioned.add(idx)
                    # Lenient: accept the model's varied shapes (null / string / list);
                    # an unusable value skips the chunk (-> empty) instead of failing the batch.
                    if labels is None:
                        labels = []
                    elif isinstance(labels, str):
                        labels = [labels]
                    elif not isinstance(labels, list):
                        continue
                    labels = [x for x in labels if isinstance(x, str)]
                    suggestions[idx] = labels
                # An index the response never mentioned is a contract violation,
                # not an answer: the prompt this same call sends says "Every index
                # MUST be present" and "use [] for chunks with no matching label",
                # so [] is how the model says no-match and absence says something
                # else. Filling those with [] and filing them under "the model
                # chose not to label them" stored the document's chunks unlabelled
                # and reported a clean Ingested.
                #
                # Returns the partial map plus the missing indices, NOT None.
                # The caller keeps what the model DID answer and re-asks only
                # the absent ones: returning None told it the whole batch was
                # unusable, so it re-asked every chunk in it — five calls with
                # their own retry ladders, one semaphore slot, against a phase
                # ceiling sized on batch count and blind to the expansion. This
                # is what _context_batch_call already does for the same
                # violation on the contextual side.
                #
                # A value that is present but unusable stays lenient and becomes
                # [], as before — the batch parser has always recovered from a bad
                # VALUE without re-asking. Only an absent KEY is a failure.
                missing = [i for i in indices if i not in mentioned]
                if missing:
                    _llm_fallback_total.add(len(missing), {"phase": PHASE_LABEL_LABELING, "reason": "batch_parse"})
                    # _safe_log, not _write_ingestion_log: a logging failure
                    # escaping into the ingest path is caught by the outer
                    # except in ingest_file_with_guardrail, which then retracts
                    # every chunk the finished batches committed. See _safe_log.
                    await _safe_log(
                        self._write_ingestion_log,
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Batch labeling response omitted chunk indices {missing}; "
                        f"re-asking those {len(missing)} of {len(indices)} only.",
                    )
                # Every index that was mentioned is answered: absent from
                # `suggestions` means its value was unusable, which is a [] the
                # model did ask for.
                for i in indices:
                    if i not in missing:
                        suggestions.setdefault(i, [])
                span.set_attribute("dataprep.labels_suggested", sum(len(v) for v in suggestions.values()))
                _usage = getattr(response, "usage", None)
                if getattr(_usage, "completion_tokens", None) is not None:
                    span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                    span.set_attribute("dataprep.llm.prompt_tokens", getattr(_usage, "prompt_tokens", 0))
                return suggestions, missing
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:200]}"
                if _is_vllm_input_overflow(e):
                    _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "llm_call_batch"})
                    with suppress(Exception):
                        span.set_attribute("dataprep.input_too_long", True)
                    await self._write_ingestion_log(
                        file_id,
                        "ERROR",
                        "Labeling",
                        f"Batch labeling vLLM context overflow ({err}). Aborting.",
                    )
                    raise DataprepInputTooLongError(f"vLLM context overflow at llm_call_batch: {err}") from e
                # The batched call IS the path that stalls in practice (a
                # 260-chunk document issues 65 of them), so the timeout marker
                # belongs here as much as on the per-chunk call. Without it this
                # span closes with no tokens and no status — indistinguishable
                # from one still in flight.
                if _is_timeout(e):
                    with suppress(Exception):
                        span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                        span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {indices} ({err}); returning None for per-chunk fallback.",
                )
                # Counted here, not in the caller: this function swallows every
                # failure and returns None, so the caller's own error handler
                # never runs for a call that failed — only for one whose parse
                # failed. Counting there would leave batch_error permanently
                # zero and file every timeout under batch_parse, which is the
                # opposite of what an operator querying a contended GPU needs to
                # see.
                _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "batch_error"})
                return None

    async def _finalize_chunk_labels(self, index, suggested, all_labels, file_id, file_labels=None) -> list[str]:
        """Resolve raw LLM suggestions against the taxonomy, then scope to the document.

        Suggestions are first canonicalised against the full taxonomy (exact +
        synonym match). The LLM is prompted with the full taxonomy, so it may
        suggest labels that are valid taxonomy entries but outside the document's
        scope (e.g. a sibling crop on a single-crop guide). ``file_labels`` defines
        the eligible scope: any resolved label not in ``file_labels`` is dropped
        before storage. When ``file_labels`` is empty, no scoping is applied
        (preserves the legacy taxonomy-validated behaviour and avoids dropping
        every label on documents without a scope).

        Consolidates per-label progress logs into a single summary entry per chunk
        (previously ~3.7 logs/chunk flooded the backend ingestion-log endpoint).
        """
        final_labels: set[str] = set()
        new_labels: list[str] = []
        for label in suggested:
            if not isinstance(label, str) or not label:
                # A malformed LLM response can yield null/non-string entries in
                # the suggestion list — skip them instead of crashing the whole
                # file ingest (the chunk still ingests; an absent label is the
                # documented fallback). Live: vLLM returned a null label and
                # `label.lower()` 500'd every ingest of the file (2026-09-14).
                continue
            if label in final_labels:
                continue
            if label in all_labels:
                final_labels.add(label)
                continue
            # Fuzzy/synonym match (plural, case-insensitive).
            match = next((x for x in all_labels if x.lower() == label.lower()), None)
            if not match and label.endswith("s"):
                match = next((x for x in all_labels if x.lower() == label[:-1].lower()), None)
            if not match:
                match = next((x for x in all_labels if x.lower() == label.lower() + "s"), None)
            if match:
                final_labels.add(match)
            elif not _is_acl_label(label):
                # ACL tokens (t:/r:/d:) are enforcement labels, not taxonomy
                # candidates — never WARN "consider adding to the Knowledge
                # Hierarchy" for them (OKF gap G4, Story 2.6a critic gap #2).
                # They are unioned verbatim from file_labels below.
                new_labels.append(label)

        # Store the labels in the taxonomy's own order, so the array is a
        # function of the label set alone — not of the order the model happened
        # to answer in — and the same as what the other labelling strategies
        # store. Every resolved label comes from the taxonomy, so filtering
        # the taxonomy is the whole ordering.
        labels_list = [label for label in all_labels if label in final_labels]
        # Scope to the document's file_labels: drop taxonomy-valid labels that
        # fall outside the document's scope (e.g. sibling crops on a single-crop
        # guide). Skipped when file_labels is empty so documents without a scope
        # keep all taxonomy-validated labels.
        dropped = []
        if file_labels:
            scope = set(file_labels)
            dropped = [l for l in labels_list if l not in scope]
            labels_list = [l for l in labels_list if l in scope]

        # Preserve ACL labels (t:<tenant>, r:<repo_id>, d:<domain>) AND the
        # minted version tags (okf:v{N}) carried in file_labels. These are
        # access-control/version tokens, NOT taxonomy entries: never
        # taxonomy-resolved or scoped — propagated verbatim so the retriever
        # can enforce per-tenant/repo/domain isolation (OKF gap G4, Story
        # 2.6a) and version pinning (review P7). Unioned AFTER the scope
        # filter (authoritative, not subject to taxonomy scoping) and
        # de-duplicated. The DEFAULT (LLM) path previously preserved only the
        # ACL tokens and dropped the version tag — the exact P7 defect the
        # embedding/bm25 paths had already fixed (round-3 review 2026-10-29).
        _acl_preserved: list[str] = []
        if file_labels:
            _existing = set(labels_list)
            for _l in file_labels:
                if (_is_acl_label(_l) or (isinstance(_l, str) and re.match(r"^okf:v\d+$", _l))) and _l not in _existing:
                    labels_list.append(_l)
                    _existing.add(_l)
                    _acl_preserved.append(_l)

        level = "INFO"
        # The LLM's RAW recommendations lead the entry (David's directive,
        # 2026-08-23: the ingestion log must include the label recommendations)
        # so each chunk reads recommendation → decision: what the LLM suggested,
        # what survived taxonomy+scope, what was dropped, what is proposed for
        # the Knowledge Hierarchy.
        raw_suggested = [l for l in (suggested or []) if isinstance(l, str)]
        msg = f"Chunk {index}: LLM label recommendations ({len(raw_suggested)}): {raw_suggested}."
        msg += f" Final labels ({len(labels_list)}): {labels_list}."
        if _acl_preserved:
            msg += f" (incl. {len(_acl_preserved)} ACL)"
        if dropped:
            msg += f" Dropped (out of bundle/document scope): {dropped}."
        if new_labels:
            level = "WARN"
            msg += f" New (non-taxonomy) labels suggested: {new_labels} — consider adding to the Knowledge Hierarchy."
        await self._write_ingestion_log(file_id, level, "Labeling", msg)
        return labels_list

    def _label_with_embedding(self, chunks: list[str], all_labels: list[str]):
        """Spec 5.4: Cosine Similarity Labeling."""
        if not self.embeddings:
            self._initialize_embeddings()

        label_vecs = self.embeddings.embed_documents(all_labels)
        results = []
        for text in chunks:
            chunk_vec = self.embeddings.embed_query(text)
            selected = []
            for i, l_vec in enumerate(label_vecs):
                sim = dot(l_vec, chunk_vec) / (norm(l_vec) * norm(chunk_vec))
                if sim >= EMBEDDING_LABEL_THRESHOLD:
                    selected.append(all_labels[i])
            results.append({"text": text, "labels": selected})
        return results

    def _label_with_bm25(self, chunks: list[str], all_labels: list[str]):
        """Spec 5.4: BM25 Labeling."""
        tokenized_labels = [re.findall(r"\b\w+\b", l.lower()) for l in all_labels]
        bm25 = BM25Okapi(tokenized_labels)
        results = []
        for text in chunks:
            tokens = re.findall(r"\b\w+\b", text.lower())
            scores = bm25.get_scores(tokens)
            selected = [all_labels[i] for i, s in enumerate(scores) if s >= BM25_LABEL_THRESHOLD]
            results.append({"text": text, "labels": selected})
        return results

    async def _apply_labels(self, plain_chunks: list[str], all_labels: list[str], file_labels: list[str], file_id: str):
        """Returns ``(labelled_docs, reasons)``.

        ``reasons`` lists human-readable causes, empty when labelling completed,
        and it is what stops the document being reported as plainly Ingested. A
        list rather than a flag because the causes have DIFFERENT REMEDIES — see
        DEGRADED_REMEDIES. The non-LLM strategies have no budget and no failure
        mode of their own, and an empty taxonomy is a configured state rather
        than a degraded one.
        """

        # Short-circuit (OKF gap G4, Story 2.6a): when file_labels carries ACL
        # prefixes (t:/r:/d:), it is the authoritative, orchestrator/author-
        # declared label set (OKF concept frontmatter). The LLM/embedding/bm25
        # call is redundant cost and would only re-derive a subset. Preserve
        # file_labels verbatim (ACL + concept labels), de-duplicated. No-op for
        # free-form docs (no ACL prefixes -> predicate False -> falls through to
        # the normal strategy dispatch). This is also the ONLY ACL-preserve
        # mechanism for the embedding/bm25 strategies.
        #
        # REVISED (David's directive, 2026-08-23): the OKF skip is REMOVED.
        # Bundle-level labels are a CANDIDATE POOL, not forced attachments —
        # "just because the labels are applied to a bundle does not mean every
        # chunk must be labelled with those labels". The strategy runs for OKF
        # concepts too; per-chunk applicability is decided by content:
        #   chunk_labels = (LLM selections ∩ taxonomy) ∩ file_labels + ACL verbatim
        # (_finalize_chunk_labels). Retrieval matches query labels against
        # chunk labels — blanket labels would make every chunk match every
        # scoped query; per-chunk selections are what discriminate. ACL
        # tokens (t:/r:/d:) and the okf:v tag remain verbatim on every chunk
        # (access scoping + version pinning, not content labels).
        if any(_is_acl_label(_l) for _l in (file_labels or [])) and file_labels:
            await self._write_ingestion_log(
                file_id,
                "INFO",
                "Labeling",
                f"OKF labeling: bundle labels ({len(file_labels)}) are the candidate pool; "
                f"strategy={LABELING_STRATEGY} assigns per-chunk by applicability; ACL tokens verbatim.",
            )

        if not all_labels:
            await self._write_ingestion_log(
                file_id, "WARN", "Labeling", "No labels found in Taxonomy. Using only file labels."
            )
            # Without a taxonomy the document's own scope is the only label
            # source: one nameless group, sorted the same way, so the stored
            # array does not depend on the order the scope arrived in.
            fallback_labels = _canonical_taxonomy_order([("", list(file_labels or []))])
            return [{"text": c, "labels": fallback_labels} for c in plain_chunks], []

        logger.info(f"Labeling using strategy: {LABELING_STRATEGY}")

        # ACL preserve for the non-LLM strategies (the removed skip used to be
        # their only mechanism — live-flagged 2026-08-23): the embedding/bm25
        # per-chunk selections get ONLY the verbatim-union tokens — ACL prefixes
        # (t:/r:/d:) AND the minted version tags (okf:v{N} — review P7,
        # live-flagged: the tag is NOT in _ACL_LABEL_PREFIXES, so version-pinned
        # retrieval returned zero OKF chunks under these strategies).
        # The non-ACL bundle labels are NOT forced (candidate-pool semantics);
        # for those strategies the whole taxonomy is the pool.
        _acl_tokens = [
            l for l in (file_labels or []) if _is_acl_label(l) or (isinstance(l, str) and re.match(r"^okf:v\d+$", l))
        ]

        def _with_acl(results: list[dict]) -> list[dict]:
            if not _acl_tokens:
                return results
            return [
                {"text": r["text"], "labels": list(dict.fromkeys(list(r.get("labels", [])) + list(_acl_tokens)))}
                for r in results
            ]

        if LABELING_STRATEGY == "embedding":
            # Offload CPU-bound embedding calculations to a thread
            return _with_acl(await asyncio.to_thread(self._label_with_embedding, plain_chunks, all_labels)), []
        elif LABELING_STRATEGY == "bm25":
            # Offload CPU-bound BM25 calculations to a thread
            return _with_acl(await asyncio.to_thread(self._label_with_bm25, plain_chunks, all_labels)), []
        else:
            # Default to LLM (with retry fix and advisory logic). _finalize_chunk_labels
            # already scopes to the bundle pool + preserves ACL verbatim.
            return await self._label_with_llm(plain_chunks, all_labels, file_labels, file_id)

    # --- Main Ingestion Logic (Async + Batched) ---

    async def _process_batch(self, batch_docs, current_batch_num, total_batches, input, graph_name, semaphore):
        """Helper to process a single batch with concurrency control.

        Returns ``{"inserted": int, "failed": bool}`` — the count of graph
        documents that actually landed and whether an infrastructure/model
        failure was hit in this batch. P0 (David, 2026-09-09): batch failures
        were swallowed (warn + skip) and the ingest still reported
        'Ingested' — rows went 'indexed' with chunk_counts over a ZERO-write
        graph and an empty graph SERVED. The caller now sums these outcomes
        and refuses the success verdict when everything failed and nothing
        landed. An honest empty extraction (no exception, no entities) is NOT
        a failure and stays 'Ingested'."""
        async with semaphore:
            try:
                await self._write_ingestion_log(
                    input.file_id, "INFO", "Graph", f"Processing Batch {current_batch_num}/{total_batches}..."
                )

                # We need to wrap the synchronous graph transformer calls in asyncio.to_thread
                # to avoid blocking the event loop if they are heavy CPU tasks.
                # Remote-LLM resilience: the retry ladder absorbs transient
                # gateway storms (502/503/504 + connection errors) per request.
                try:
                    graph_docs = await _call_llm_resilient(
                        lambda: asyncio.to_thread(self.llm_transformer.convert_to_graph_documents, batch_docs),
                        what=f"Graph extraction batch {current_batch_num}/{total_batches}",
                    )
                except Exception as ge:
                    logger.error(f"Batch {current_batch_num} graph conversion failed: {type(ge).__name__}: {ge}")
                    raise

                if graph_docs:
                    logger.info(f"Batch {current_batch_num}: {len(graph_docs)} graph_docs extracted")
                    # Run graph insertion in a thread as well if it's blocking
                    try:
                        await asyncio.to_thread(
                            self.graph.add_graph_documents,
                            graph_documents=graph_docs,
                            include_source=getattr(input, "include_chunks", True),
                            graph_name=graph_name,
                            use_one_entity_collection=True,
                            embeddings=self.embeddings,
                            embedding_field="embedding",
                            embed_source=getattr(input, "embed_chunks", True),
                            embed_nodes=getattr(input, "embed_nodes", True),
                            embed_relationships=getattr(input, "embed_edges", True),
                            capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper"),
                        )
                    except Exception as embed_err:
                        logger.error(
                            f"Batch {current_batch_num} graph insertion failed: {type(embed_err).__name__}: {embed_err}"
                        )
                        raise
                    return {"inserted": len(graph_docs), "failed": False}
                # Extraction succeeded but found no entities in this batch — an
                # honest empty, not a failure.
                return {"inserted": 0, "failed": False}
            except (ValidationError, Exception) as ve:
                logger.warning(f"Batch {current_batch_num} failed graph extraction: {ve}")
                await self._write_ingestion_log(
                    input.file_id,
                    "WARN",
                    "Graph",
                    f"Batch {current_batch_num} skipped due to extraction error: {str(ve)}",
                )

                async def _retry_round(round_label):
                    """Per-doc retry of a failed batch. Returns (inserted, last_error)."""
                    inserted = 0
                    last_err = None
                    for retry_doc in batch_docs:
                        try:
                            retry_graph_docs = await _call_llm_resilient(
                                lambda d=retry_doc: asyncio.to_thread(
                                    self.llm_transformer.convert_to_graph_documents, [d]
                                ),
                                what=f"Graph extraction retry ({round_label})",
                            )
                            if retry_graph_docs:
                                await asyncio.to_thread(
                                    self.graph.add_graph_documents,
                                    graph_documents=retry_graph_docs,
                                    include_source=getattr(input, "include_chunks", True),
                                    graph_name=graph_name,
                                    use_one_entity_collection=True,
                                    embeddings=self.embeddings,
                                    embedding_field="embedding",
                                    embed_source=getattr(input, "embed_chunks", True),
                                    embed_nodes=getattr(input, "embed_nodes", True),
                                    embed_relationships=getattr(input, "embed_edges", True),
                                    capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper"),
                                )
                                inserted += len(retry_graph_docs)
                        except Exception as inner_e:
                            last_err = f"{type(inner_e).__name__}: {str(inner_e)[:200]}"
                            logger.error(f"Skipping individual bad document: {inner_e}")
                    return inserted, last_err

                # ROUND 1: per-doc retry.
                inserted, last_err = await _retry_round("r1")
                # ROUND 2 (David's resilience contract): if the whole batch still
                # produced nothing, give the gateway one more chance after a
                # settle delay before the batch is accounted failed.
                if inserted == 0 and _LLM_ROUND2_DELAY_S > 0:
                    await self._write_ingestion_log(
                        input.file_id,
                        "INFO",
                        "Graph",
                        f"Batch {current_batch_num}: retrying the failed batch in {_LLM_ROUND2_DELAY_S}s "
                        "(transient gateway storm tolerance).",
                    )
                    await asyncio.sleep(_LLM_ROUND2_DELAY_S)
                    inserted, last_err = await _retry_round("r2")
                return {"inserted": inserted, "failed": True, "last_error": last_err or str(ve)[:300]}

    def _ensure_graph_collections(self, graph_name: str):
        """Register the per-repo NAMED graph (gharial) — its creation
        auto-creates the four member collections (David, 2026-09-09: manual
        collection pre-creation was redundant — "the underlying collections
        can be created automatically during the graph creation process").

        Self-heal for crash debris: if the graph definition exists but a
        member collection is missing (a partial teardown), drop the
        DEFINITION (collections untouched) and re-register — auto-creation
        fills exactly the gaps. A healthy graph is a no-op return.
        """
        suffixes = ("_SOURCE", "_ENTITY", "_HAS_SOURCE", "_LINKS_TO")
        try:
            missing = [s for s in suffixes if not self.db.has_collection(f"{graph_name}{s}")]
            if self.db.has_graph(graph_name):
                if not missing:
                    return  # healthy — nothing to do
                logger.warning(
                    f"[ ensure-graph ] Graph {graph_name} exists but {len(missing)} member collection(s) "
                    f"missing {missing} — re-registering the definition (auto-creation fills the gaps)."
                )
                self.db.delete_graph(graph_name, ignore_missing=True)  # definition only; collections untouched
            self.db.create_graph(
                graph_name,
                edge_definitions=[
                    {
                        "edge_collection": f"{graph_name}_HAS_SOURCE",
                        "from_vertex_collections": [f"{graph_name}_ENTITY"],
                        "to_vertex_collections": [f"{graph_name}_SOURCE"],
                    },
                    {
                        "edge_collection": f"{graph_name}_LINKS_TO",
                        "from_vertex_collections": [f"{graph_name}_ENTITY"],
                        "to_vertex_collections": [f"{graph_name}_ENTITY"],
                    },
                ],
            )
            logger.info(f"[ ensure-graph ] Registered named graph {graph_name}")
        except Exception as e:  # pragma: no cover - already-exists / transient
            logger.warning(f"[ ensure-graph ] Could not register named graph {graph_name}: {e}")

    async def ingest_file_with_guardrail(self, input: ArangoDBDataprepRequestFromDocRepo, lock_file=None):
        """
        Asynchronous ingestion task with support for graceful 'Killed' status transitions.
        Ensures auto-retraction occurs if the task is cancelled or fails.
        """
        # NOTE: lock_file is passed from the microservice and is already LOCKED.
        # We are responsible for releasing and closing it in the finally block.
        # Story 4.8-amend (David's 4th-time directive, 2026-08-20): stash
        # the input + repo_id on the instance so the per-stage log POST
        # helper can mirror into the bundle zip's ingestion_log (file-centric UI).
        self._current_input = input
        # The caller's EXPLICIT repo_id is the identity channel (David,
        # 2026-08-31): born-right graph names encode repo NAME+VERSION, not the
        # repo_id — a graph name is a name, not an identity field. A graph
        # whose name carries the OKF_ prefix is a ROUTING MARKER only (the
        # completion callback belongs to the OKF control plane); it must never
        # be mistaken for a repo id — the old graph-name-suffix parse produced
        # `kenya-gov_v3`-shaped repo ids that misrouted completion callbacks
        # and left files stuck Ingesting (review 2026-10-29, JR dataprep
        # fallback finding).
        self._current_repo_id = getattr(input, "repo_id", None)
        self._current_okf_graph_hint = False
        if not self._current_repo_id:
            try:
                graph_name = input.graph_name or ""
            except AttributeError:
                graph_name = ""
            self._current_okf_graph_hint = graph_name.startswith("OKF_")
        # The bundle-id cache is keyed by concept_id, but concept ids RECUR
        # across runs/repos ('index', 'service_directory', ...). A cache hit
        # from a previous ingest would mirror this run's logs into the
        # PREVIOUS (possibly deleted) bundle. Invalidate on every ingest —
        # the lookup is one cheap GET per concept (live-caught 2026-08-21:
        # a whole run's 25 stage logs landed on the prior run's bundle id).
        self._bundle_file_id_cache = {}
        # Same recurrence reasoning, same per-ingest invalidation: concept
        # ids recur across runs, so a name cached for concept 'index' in a
        # previous ingest would surface the PREVIOUS repo's filename here.
        # The request-local _INGEST_CTX['name_cache'] covers the production
        # path; this singleton-wide map is a legacy fallback and must not
        # grow one permanent entry per concept ever ingested.
        self._concept_file_name_cache = {}
        # Cache the concept's filename eagerly so the per-stage log prefix
        # is populated without an extra lookup.
        concept_id = getattr(input, "concept_id", None)
        if concept_id:
            file_name = getattr(input, "file_name", None)
            if file_name:
                self._concept_file_name_cache[concept_id] = file_name
        # PARALLEL-INGEST: bind the request-local context (task-scoped) so
        # concurrent ingests never share bundle-log caches or callback
        # repo_id. The self-stash above remains for legacy readers.
        # okf_graph_hint rides in the SAME ctx (already derived above, before
        # this set) so the completion callback routes off ONE per-request
        # source for both values — a bound ctx that hardcoded the hint to
        # False misrouted an OKF_-graph ingest that carries no repo_id
        # (review 2026-10-29 round 2, thread e0e879eb).
        _INGEST_CTX.set(
            {
                "input": input,
                "repo_id": self._current_repo_id,
                "okf_graph_hint": self._current_okf_graph_hint,
                "bundle_cache": {},
                "name_cache": {},
            }
        )

        try:
            with background_span("dataprep.ingest.background"):
                # --- START PROTECTED EXECUTION (Spec 5.1) ---
                await self._update_doc_status(input.file_id, "Ingesting", concept_id=getattr(input, "concept_id", None))
                await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion task started.")

                try:
                    # 1. Fetch Taxonomy (FROM BACKEND)
                    all_labels = await self._fetch_all_labels()

                    self._initialize_llm(
                        allowed_node_types=getattr(input, "allowed_node_types", []),
                        allowed_edge_types=getattr(input, "allowed_edge_types", []),
                        node_properties=getattr(input, "node_properties", ["description"]),
                        edge_properties=getattr(input, "edge_properties", ["description"]),
                    )

                    doc_path = DocPath(
                        path=input.file_path,
                        chunk_size=input.chunk_size,
                        chunk_overlap=input.chunk_overlap,
                        process_table=input.process_table,
                        table_strategy=input.table_strategy,
                    )

                    # 2. Extract and Chunk Content
                    chunks = await self._load_and_chunk(doc_path)
                    if not chunks:
                        raise Exception("No valid content extracted from file.")

                    await self._write_ingestion_log(
                        input.file_id, "INFO", "Chunking", f"Generated {len(chunks)} chunks."
                    )

                    # 3. Guardrail Check
                    gr_result = await self._run_guardrail(chunks)
                    if not gr_result["success"]:
                        await self._write_ingestion_log(input.file_id, "ERROR", "Guardrail", gr_result["message"])
                        raise Exception("Guardrail Violation")

                    # 4. Contextual Retrieval (optional) + Labeling (Spec 5.3, 5.4)
                    file_labels = getattr(input, "file_labels", [])
                    original_chunks = list(chunks)
                    # When enabled, prepend an LLM-generated document context to each
                    # chunk so the embedding carries the document's subject (see
                    # spec-contextual-retrieval.md). No-op (returns chunks unchanged)
                    # when CONTEXTUAL_RETRIEVAL_ENABLED=false.
                    # Decoupled mode (CONTEXTUAL_LABEL_RAW, default true): label the
                    # RAW chunk (the context prefix distorts labeling — over/under-
                    # label) and use the contextualized text ONLY for the embedding.
                    # When false, the context is fed to both (label contextualized).
                    # Under decoupled mode the two stages are INDEPENDENT (labeling
                    # reads original_chunks), so run them concurrently — serially they
                    # added the entire labeling wall time on top of contextualization
                    # (review 2026-10-15). Both streams share the module-global batch
                    # gate, so gathering does not raise total vLLM concurrency.
                    if CONTEXTUAL_LABEL_RAW:
                        (
                            (contextualized, contextual_reasons),
                            (labelled_docs, labelling_reasons),
                        ) = await asyncio.gather(
                            self._apply_contextualization(original_chunks, input, input.file_id),
                            self._apply_labels(original_chunks, all_labels, file_labels, input.file_id),
                        )
                    else:
                        contextualized, contextual_reasons = await self._apply_contextualization(
                            original_chunks, input, input.file_id
                        )
                        labelled_docs, labelling_reasons = await self._apply_labels(
                            contextualized, all_labels, file_labels, input.file_id
                        )
                    # (phase, why) pairs rather than names: the two causes have
                    # different fixes, and telling an operator to raise a budget
                    # for a client that will not build wastes their afternoon.
                    degraded_phases = [
                        (name, reason)
                        for name, reasons in (
                            ("Contextual Retrieval", contextual_reasons),
                            ("LLM labeling", labelling_reasons),
                        )
                        for reason in reasons
                    ]

                    # 5. Graph Insertion (BATCHED & CONCURRENT)
                    # BREAKING CHANGE (v1.3 → v1.5): default changed from "genie_graph" to "GRAPH".
                    # Existing deployments with graph name "genie_graph" must set ARANGO_GRAPH_NAME=genie_graph
                    # in .env to restore v1.3 behavior, otherwise retract_file() will fail.
                    graph_name = getattr(input, "graph_name", os.getenv("ARANGO_GRAPH_NAME", "GRAPH"))
                    # OKF per-repo graph (Story 2.9.6, G5): ensure the graph's
                    # collections exist before writing (no-op for the default graph).
                    self._ensure_graph_collections(graph_name)

                    documents_to_process = []
                    for i, doc in enumerate(labelled_docs):
                        # metadata.chunk_text preserves the original (un-contextualized)
                        # chunk for display/debug. Only written when contextualization is
                        # enabled (flag off → true no-op, page_content already == original).
                        # Guard i so a future _apply_labels change that altered chunk
                        # count/order can never raise here (never block ingestion).
                        metadata = {
                            "file_id": input.file_id,
                            "file_path": input.storage_path,
                            "chunk_index": i,
                            "chunk_labels": doc["labels"],
                        }
                        # Story 2.9.7 (ADR-031): the minted repo version is stamped
                        # onto every chunk doc (version-pinned citation). Absent on
                        # the request → no stamp (legacy behavior unchanged). Strict
                        # int check: a non-int (e.g. a mock / corrupt payload) is
                        # treated as absent, never stamped truthy-garbage.
                        bv = getattr(input, "bundle_version", None)
                        if isinstance(bv, int):
                            metadata["bundle_version"] = bv
                        # Story 4.8-amend (2026-08-19): the OKF concept id is stamped
                        # onto every chunk doc (citation provenance — a retrieved chunk
                        # resolves to its concept without a files-doc join). Absent on
                        # the request → no stamp (legacy single-file behavior).
                        cid = getattr(input, "concept_id", None)
                        if isinstance(cid, str) and cid:
                            metadata["concept_id"] = cid
                        if CONTEXTUAL_RETRIEVAL_ENABLED and i < len(original_chunks):
                            metadata["chunk_text"] = original_chunks[i]
                        # Embed the contextualized text (subject propagation); falls back
                        # to the labelled text when indexing is somehow misaligned.
                        embed_text = contextualized[i] if i < len(contextualized) else doc["text"]
                        documents_to_process.append(Document(page_content=embed_text, metadata=metadata))

                    # Chunks per graph-extraction batch. Each batch runs as one task
                    # under the (now global) batch gate, but convert_to_graph_documents
                    # makes ONE vLLM call PER CHUNK sequentially inside its batch thread
                    # — so smaller batches = finer parallelism under the same gate.
                    # Env-tunable (review 2026-10-15); 3 keeps ~12 docs in flight at
                    # gate=4 instead of 40 serialized inside 4 fat threads.
                    BATCH_SIZE = int(os.getenv("DATAPREP_GRAPH_BATCH_SIZE", "10"))
                    total_batches = (len(documents_to_process) + BATCH_SIZE - 1) // BATCH_SIZE

                    self.graph = ArangoGraph(db=self.db, generate_schema_on_init=False)
                    semaphore = _global_batch_gate()
                    tasks = []

                    for i in range(0, len(documents_to_process), BATCH_SIZE):
                        batch_docs = documents_to_process[i : i + BATCH_SIZE]
                        current_batch_num = (i // BATCH_SIZE) + 1

                        # Schedule batch processing with concurrency control
                        task = asyncio.create_task(
                            self._process_batch(
                                batch_docs, current_batch_num, total_batches, input, graph_name, semaphore
                            )
                        )
                        tasks.append(task)

                    # Wait for all batches to complete
                    #
                    # Not run through _gather_with_phase_budget, unlike the two
                    # LLM phases above. That helper cancels stragglers on its
                    # deadline, which is only safe because the labeling and
                    # context phases have a fallback that turns an abandoned
                    # batch into a degraded-but-present result. This phase has
                    # none: a cancelled batch loses its chunks outright and the
                    # ingest still ends "Ingested" — silently dropping documents
                    # from the knowledge graph is strictly worse than a slow one.
                    # So this phase is unbounded, but it still HEARTBEATS, because a
                    # wedged graph phase is just as silent as the LLM phases
                    # were and the whole point is that it is visible.
                    #
                    # Its clients are not ours to bound. The embedding half runs
                    # inside the vendored comps dataprep, which reads VLLM_TIMEOUT
                    # from a bare os.getenv — so a value would reach httpx as a
                    # string, which 0.28 does not coerce, and the client raises
                    # TypeError instead of timing out. That is why no compose
                    # line injects it (see OVERRIDES.yaml). The ArangoDB writes
                    # go through langchain-arangodb / py-arango, which carry
                    # their own socket timeouts and take no HTTP budget.
                    # Zero-batch ingest (documents_to_process == []): no batch
                    # tasks are scheduled, so `results` must be bound anyway —
                    # left unbound, the totals below raised UnboundLocalError
                    # and the generic handler falsely marked the file
                    # 'Ingestion Error' and auto-retracted an honest empty run
                    # (review 2026-10-29 round 3).
                    results = []
                    if tasks:
                        results = await _await_with_heartbeat(
                            tasks,
                            phase="Graph insertion",
                            total=len(tasks),
                            file_id=input.file_id,
                            write_ingestion_log=self._write_ingestion_log,
                        )

                    # Empty-graph refusal (P0, David 2026-09-09): a batch/model
                    # failure used to be swallowed per batch while the pipeline
                    # still reported 'Ingested' — the meta row went 'indexed'
                    # with chunk_counts and an EMPTY graph served. Zero documents
                    # inserted across failed batches = the ingestion FAILED: the
                    # raise routes into the designed error path below ('Ingested
                    # Error' callback + auto-retract), the row never reaches
                    # 'indexed', and the drain-level D4-b self-heal re-ingests it.
                    results = results or []
                    inserted_total = sum(r["inserted"] for r in results if r)
                    failed_batches = sum(1 for r in results if r and r.get("failed"))
                    last_err = next((r.get("last_error") for r in results if r and r.get("last_error")), None)
                    await self._write_ingestion_log(
                        input.file_id,
                        "INFO" if inserted_total or not failed_batches else "WARN",
                        "Graph",
                        f"Graph insertion totals: {inserted_total} document(s) written, "
                        f"{failed_batches}/{total_batches} batch(es) hit failures.",
                    )
                    if documents_to_process and inserted_total == 0 and failed_batches > 0:
                        raise Exception(
                            f"Graph insertion failed for all {total_batches} batch(es): "
                            "0 graph documents were written after retries — refusing to report "
                            f"ingested over an empty graph. Last error: {last_err or 'unknown'}"
                        )

                    # Ensure the vector index matches the embedder dim
                    # (recreate if dim drift). Failures are swallowed — see
                    # ensure_vector_index() docstring. Runs once every graph
                    # task has settled so all chunks are visible for index
                    # creation, and
                    # BEFORE Ingested status flip so the retriever never
                    # queries a missing/stale index.
                    _metric, _n_lists = _read_index_params()
                    await ensure_vector_index(
                        self.db.collection(f"{graph_name}_SOURCE"),
                        metric=_metric,
                        n_lists=_n_lists,
                        graph_name=graph_name,
                        file_id=input.file_id,
                        write_ingestion_log=self._write_ingestion_log,
                    )

                    # 6. Final log BEFORE the terminal status callback (review P1b,
                    # live-caught v13b): the 'Ingested' callback transitions the meta
                    # row and can SETTLE the bundle (status PATCH to Ingested) — a
                    # consumer polling the bundle status then reading the logs would
                    # see the settle before this final stage row landed. Log first,
                    # then announce completion.
                    #
                    # A phase that ran out of budget leaves the document
                    # incomplete: some chunks carry the document's file labels
                    # instead of model labels, or raw text instead of generated
                    # context. "Ingested" claims the whole document landed, so a
                    # degraded one is reported as "Ingested with Warnings" — a
                    # state the API schema, the i18n catalogue and the admin
                    # badge all already carry. Not retracted: the batches that
                    # did finish are real work, and the warning state is what
                    # makes the shortfall visible instead of silent.
                    if degraded_phases:
                        # One sentence per cause, each naming the knob that fixes
                        # THAT cause. A single combined sentence either lies
                        # about what happened or gives a remedy that does not
                        # apply — an operator who raises a budget because the
                        # message says to, re-ingests, and gets the identical
                        # failure because the endpoint was the problem.
                        #
                        # Every cause is reported, not just the first: two phases
                        # degrading for two different reasons is the normal case
                        # when a GPU node is unhealthy, and naming one of them
                        # sends the operator to fix it and find the other still
                        # broken.
                        remedy_sentences = []
                        for name, reason in degraded_phases:
                            remedy = DEGRADED_REMEDIES.get(_degraded_cause(reason))
                            if remedy is None:
                                # No remedy mapped for this cause: report it
                                # verbatim rather than borrowing another cause's
                                # advice, which would be a guess presented as
                                # a diagnosis.
                                remedy_sentences.append(f"{name}: {reason}.")
                            else:
                                # The reason comes first and verbatim, so the line
                                # is greppable on the phrase the runbook quotes and
                                # keeps the (0/N) counts the remedy drops. Then the
                                # advice for this cause specifically.
                                remedy_sentences.append(
                                    f"{name}: {reason} — "
                                    + remedy.format(phase=name, seconds=DATAPREP_LLM_PHASE_TIMEOUT_SECONDS)
                                )
                        await self._write_ingestion_log(
                            input.file_id,
                            "WARN",
                            "System",
                            "Ingestion completed DEGRADED — status set to 'Ingested with Warnings'. "
                            + " ".join(remedy_sentences),
                        )
                    else:
                        await self._write_ingestion_log(
                            input.file_id,
                            "INFO",
                            "System",
                            "Ingestion completed successfully.",
                        )
                    ingest_status = "Ingested with Warnings" if degraded_phases else "Ingested"
                    await self._update_doc_status(
                        input.file_id,
                        ingest_status,
                        chunk_count=len(chunks),
                        concept_id=getattr(input, "concept_id", None),
                    )

                    return {
                        "status": 200,
                        "message": f"Successfully ingested {len(chunks)} chunks.",
                        "graph_name": graph_name,
                    }

                except asyncio.CancelledError:
                    # --- KILL SWITCH HANDLING (Spec 3.1 & 4.2) ---
                    # Triggered when task.cancel() is called from the microservice
                    kill_msg = f"Ingestion for {input.file_id} was KILLED by an administrator. Rolling back..."
                    logger.warning(kill_msg)

                    # The rollback runs uninterruptible. This handler is a chain of
                    # awaits, and an await inside a cancellation path is itself
                    # cancellable: a second task.cancel() — a double-clicked Kill,
                    # which this endpoint allows, or a shutdown sweep — used to land
                    # on the first await and skip the rest. The result was a
                    # document with its chunks half-deleted, still served to the
                    # retriever, and a status that never reached "Killed" because
                    # the flip was after the retracted cascade.
                    interrupted = await _run_uninterruptible(
                        self._rollback_killed_ingest(
                            input.file_id,
                            getattr(input, "graph_name", "GRAPH"),
                            concept_id=getattr(input, "concept_id", None),
                        ),
                        timeout=_ROLLBACK_CANCEL_GRACE_SECONDS,
                        label=f"rollback of {input.file_id}",
                    )
                    if interrupted:
                        logger.warning(
                            f"{input.file_id}: cancelled again during the kill rollback; "
                            "the rollback was allowed to finish anyway"
                        )
                    raise  # Re-raise to ensure the task terminates properly

                except Exception as e:
                    # --- ERROR HANDLING & AUTO-RETRACTION (Spec 5.5) ---
                    error_msg = f"Ingestion failed: {str(e)}"
                    logger.error(error_msg)

                    await self._write_ingestion_log(input.file_id, "ERROR", "System", f"{error_msg}. Rolling back.")
                    # Failure clarity (David, 2026-09-09): the callback CARRIES the
                    # cause — the row's last_error names what actually went wrong
                    # instead of the generic 'Ingestion Error (chunks=0)' wrapper.
                    await self._update_doc_status(
                        input.file_id,
                        "Ingestion Error",
                        concept_id=getattr(input, "concept_id", None),
                        error=str(e)[:500],
                    )

                    # Auto-retract created data
                    await self.retract_file(file_id=input.file_id, graph_name=getattr(input, "graph_name", "GRAPH"))
                    await self._write_ingestion_log(
                        input.file_id, "INFO", "System", "Rollback complete. Document retracted."
                    )

                    raise HTTPException(status_code=500, detail=error_msg) from e

        finally:
            # --- LOCK MANAGEMENT ---
            # Release the file lock so the next document can be processed
            if lock_file:
                if fcntl is not None:  # Windows dev checkout: no-op
                    fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()

    async def _rollback_killed_ingest(self, file_id: str, graph_name: str, *, concept_id: str | None = None) -> None:
        """Undo a killed ingest: retract what was written, then mark it Killed.

        Split out of the ``except asyncio.CancelledError`` block so the whole
        sequence can be handed to ``_run_uninterruptible`` as one unit. Inline,
        a second cancellation could abort it between any two steps; as a single
        coroutine, nothing lands inside it.
        """
        await self._write_ingestion_log(file_id, "WARN", "System", "Ingestion process killed. Starting cleanup...")
        try:
            await self.retract_file(file_id=file_id, graph_name=graph_name)
        finally:
            # The status flip runs even when the retract fails. Inlined it was
            # simply the statement after the call, so a failed retract left the
            # document on whatever status it last had — partially deleted, with
            # nothing on the record that an operator killed it.
            with suppress(Exception):
                await self._update_doc_status(file_id, "Killed", concept_id=concept_id)
        await self._write_ingestion_log(file_id, "INFO", "System", "Cleanup complete. Document state set to Killed.")

    async def retract_file(self, file_id: str, graph_name: str):
        """
        Retracts a file and performs a clean graph cascade deletion in explicit steps.
        Order: Identify -> Delete Chunks -> Delete Edges -> Delete Orphans

        LOG DISCIPLINE (2026-10-13) — outcome first, intent second.
        This runs on EVERY ingest: okf-server's ingestWorker always retracts the
        concept before POSTing it (defensive stale-chunk sweep — dataprep
        appends, never replaces). The overwhelmingly common outcome is therefore
        "found 0, removed nothing", which is the reassuring case. The previous
        shape emitted the alarming "Starting retraction analysis..." line FIRST
        and unconditionally, then the outcome on the second line: a curator
        scanning the bundle's Ingestion Log tab read the intent line, concluded
        his data was being deleted, and stopped reading. Behaviour is unchanged
        — the find still always runs (it is the orphan-cleanup guard) and the
        chunk count is still logged either way, so the cleanup stays auditable.
        Only the wording and its position moved.
        """
        col_source = f"{graph_name}_SOURCE"
        col_entity = f"{graph_name}_ENTITY"
        col_has_source = f"{graph_name}_HAS_SOURCE"
        col_links_to = f"{graph_name}_LINKS_TO"

        # Routing identity from THIS request (review 2026-10-29 round 3): the
        # OKF_ prefix is the same routing marker the ingest path uses — the
        # completion callback belongs to the OKF control plane. Deriving it
        # here (instead of letting _update_doc_status fall back to the
        # singleton attrs) keeps a concurrent ingest from routing this
        # retract's 'Retracted' callbacks at the wrong repo
        # (DATAPREP_INGEST_CONCURRENCY > 1).
        okf_graph_hint = graph_name.startswith("OKF_")

        try:
            # ----------------------------------------------------------
            # STEP 1: Identify CHUNKS (Sources)
            # ----------------------------------------------------------
            # Fetch both the KEY and ID. Using _key allows safe deletion by key.
            aql_find_chunks = """
                FOR doc IN @@col_source
                FILTER doc.file_id == @file_id OR doc.metadata.file_id == @file_id
                RETURN { key: doc._key, id: doc._id }
            """
            cursor_chunks = self.db.aql.execute(
                aql_find_chunks, bind_vars={"@col_source": col_source, "file_id": file_id}
            )

            # These are dicts: {'key': '...', 'id': '...'}
            chunk_objects = [doc for doc in cursor_chunks]
            chunk_ids_list = [c["id"] for c in chunk_objects]
            chunk_keys_list = [c["key"] for c in chunk_objects]

            if not chunk_objects:
                # Nothing stale was found, so nothing is removed. State ONLY
                # what this function can actually observe — the count and the
                # fact that no data was deleted.
                #
                # retract_file has THREE callers: the pre-POST defensive sweep
                # in okf-server's ingestWorker (the common case, nothing stale),
                # and the CancelledError / generic-Exception rollbacks inside
                # dataprep itself. The earlier wording asserted "This is the
                # normal pre-ingest cleanup check" and "no retraction is in
                # progress" — false on both rollback paths, where this call IS
                # the retraction and the failure is exactly what a curator is
                # reading the log to find. Caller intent is not knowable from
                # here, so the message claims nothing about it. (Adversarial
                # review, 2026-10-13.)
                #
                # The chunk count stays in the message so the orphan-cleanup
                # guard remains auditable.
                log_msg = (
                    f"Analysis complete: found 0 chunks in {col_source} matching file_id {file_id}. "
                    f"Nothing to retract — no data was removed."
                )
                logger.info(log_msg)
                await self._write_ingestion_log(file_id, "INFO", "Retract", log_msg)
                await self._update_doc_status(file_id, "Retracted", okf_graph_hint=okf_graph_hint)
                return {"status": 200, "message": "No chunks found.", "details": {"deleted_chunks": 0}}

            # There IS something to retract — now, and only now, announce the
            # retraction. Announcing here (post-find, pre-delete) keeps the
            # intent line honest: it is always immediately followed by a real
            # deletion, so "Starting retraction" can never be a false alarm.
            logger.info(f"Retracting file {file_id} from {graph_name} with cascading graph cleanup.")
            log_msg = (
                f"Starting retraction analysis: found {len(chunk_objects)} chunk(s) in "
                f"{col_source} matching file_id {file_id} — proceeding with cascade cleanup."
            )
            logger.info(log_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", log_msg)

            # ----------------------------------------------------------
            # STEP 2: Identify Edges & Orphans (Before Deleting Chunks)
            # ----------------------------------------------------------
            # Find edges connected to these chunks to identify potentially orphaned entities
            aql_find_edges = """
                FOR edge IN @@col_has_source
                FILTER edge._to IN @chunk_ids_list
                RETURN { key: edge._key, id: edge._id, from: edge._from }
            """
            cursor_edges = self.db.aql.execute(
                aql_find_edges, bind_vars={"@col_has_source": col_has_source, "chunk_ids_list": chunk_ids_list}
            )
            edge_objects = [e for e in cursor_edges]

            edge_keys_list = [e["key"] for e in edge_objects]
            candidate_entity_ids = list(set([e["from"] for e in edge_objects]))

            log_msg = f"Analysis: Found {len(edge_keys_list)} HAS_SOURCE edges linking to these chunks."
            logger.info(log_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", log_msg)

            # ----------------------------------------------------------
            # STEP 3: DELETE CHUNKS (Priority 1)
            # ----------------------------------------------------------
            # We use the KEYs for safe deletion
            aql_delete_chunks = """
                FOR key IN @chunk_keys
                REMOVE key IN @@col_source OPTIONS { ignoreErrors: true }
                RETURN OLD._id
            """
            cursor_del_chunks = self.db.aql.execute(
                aql_delete_chunks, bind_vars={"@col_source": col_source, "chunk_keys": chunk_keys_list}
            )
            deleted_chunks = [doc for doc in cursor_del_chunks]

            await self._write_ingestion_log(file_id, "INFO", "Retract", f"Deleted {len(deleted_chunks)} chunks.")

            # ----------------------------------------------------------
            # STEP 4: DELETE EDGES (Priority 2)
            # ----------------------------------------------------------
            if edge_keys_list:
                aql_delete_edges = """
                    FOR key IN @edge_keys
                    REMOVE key IN @@col_has_source OPTIONS { ignoreErrors: true }
                    RETURN OLD._id
                """
                cursor_del_edges = self.db.aql.execute(
                    aql_delete_edges, bind_vars={"@col_has_source": col_has_source, "edge_keys": edge_keys_list}
                )
                deleted_edges = [doc for doc in cursor_del_edges]
                await self._write_ingestion_log(file_id, "INFO", "Retract", f"Deleted {len(deleted_edges)} edges.")

            # STEP 4.5: DELETE LINKS_TO edges associated with the file's content
            # This targets edges that were specifically formed between entities within this file
            log_msg = "Cleaning up LINKS_TO edges associated with file chunks..."
            logger.info(log_msg)

            aql_del_file_links = """
                FOR edge IN @@col_links_to
                FILTER edge.file_id == @file_id OR edge.metadata.file_id == @file_id
                REMOVE edge IN @@col_links_to OPTIONS { ignoreErrors: true }
                RETURN OLD._id
            """
            cursor_del_file_links = self.db.aql.execute(
                aql_del_file_links, bind_vars={"@col_links_to": col_links_to, "file_id": file_id}
            )
            deleted_file_links = [l for l in cursor_del_file_links]
            await self._write_ingestion_log(
                file_id, "INFO", "Retract", f"Deleted {len(deleted_file_links)} file-specific LINKS_TO edges."
            )

            # ----------------------------------------------------------
            # STEP 5: DETECT & DELETE ORPHANS (Priority 3)
            # ----------------------------------------------------------
            deleted_entities_count = 0
            if candidate_entity_ids:
                # Check if entities have ANY remaining incoming edges
                aql_find_orphans = """
                    FOR entity_id IN @candidate_ids
                        LET incoming_count = LENGTH(
                            FOR edge IN @@col_has_source
                            FILTER edge._from == entity_id
                            LIMIT 1
                            RETURN 1
                        )
                        FILTER incoming_count == 0
                        RETURN entity_id
                """
                cursor_orphans = self.db.aql.execute(
                    aql_find_orphans,
                    bind_vars={"@col_has_source": col_has_source, "candidate_ids": candidate_entity_ids},
                )
                orphan_ids = [doc for doc in cursor_orphans]  # Full IDs (Collection/Key)

                if orphan_ids:
                    await self._write_ingestion_log(
                        file_id, "INFO", "Retract", f"Identified {len(orphan_ids)} orphans. Deleting..."
                    )

                    # 5a. Delete LINKS_TO edges connected to orphans (Source OR Target)
                    # Optimization: Batch delete edges connected to these orphans
                    try:
                        aql_del_links = """
                            FOR edge IN @@col_links_to
                                FILTER edge._from IN @orphan_ids OR edge._to IN @orphan_ids
                                REMOVE edge IN @@col_links_to OPTIONS { ignoreErrors: true }
                        """
                        self.db.aql.execute(
                            aql_del_links, bind_vars={"@col_links_to": col_links_to, "orphan_ids": orphan_ids}
                        )
                    except Exception as e:
                        logger.warning(f"Error deleting links: {e}")

                    # 5b. Delete Entities
                    # Extract keys in Python to avoid AQL parsing issues inside REMOVE loop
                    orphan_keys = [oid.split("/")[-1] for oid in orphan_ids]

                    try:
                        aql_del_entities = """
                            FOR key IN @keys
                                REMOVE key IN @@col_entity OPTIONS { ignoreErrors: true }
                        """
                        self.db.aql.execute(
                            aql_del_entities, bind_vars={"@col_entity": col_entity, "keys": orphan_keys}
                        )
                        deleted_entities_count = len(orphan_keys)
                    except Exception as e:
                        logger.warning(f"Error deleting entities: {e}")
                        deleted_entities_count = 0

                    await self._write_ingestion_log(
                        file_id, "INFO", "Retract", f"Deleted {deleted_entities_count} orphan entities."
                    )

            # ----------------------------------------------------------
            # FINAL REPORT
            # ----------------------------------------------------------
            await self._update_doc_status(file_id, "Retracted", okf_graph_hint=okf_graph_hint)

            final_msg = (
                f"Retraction Complete. Deleted: {len(chunk_keys_list)} Chunks, "
                f"{len(edge_keys_list)} Edges, {deleted_entities_count} Entities."
            )
            logger.info(final_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", final_msg)

            return {
                "status": 200,
                "message": final_msg,
                "details": {
                    "deleted_chunks": len(chunk_keys_list),
                    "deleted_edges": len(edge_keys_list),
                    "deleted_entities": deleted_entities_count,
                },
            }

        except AQLQueryExecuteError as e:
            if e.error_code == 1203:
                logger.warning(f"Graph Collection {graph_name} not found. Nothing to retract.")
                return {"status": 200, "message": "Graph not found, nothing to retract."}

            err_msg = f"AQL Error during retraction: {str(e)}"
            logger.error(err_msg)
            await self._write_ingestion_log(file_id, "ERROR", "Retract", err_msg)
            raise e
