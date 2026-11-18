# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Config-gated vLLM embedding backend (Task-14 mirror, ROCm path).

Task 14 gave the RERANKER a config-gated GPU backend: on a ROCm host whose
TEI image cannot run on the GPU (gfx1151 — Instinct-only kernels), the
profile flips the reranker to a third vLLM instance serving the same
cross-encoder. This module mirrors that pattern for EMBEDDINGS: the TEI
ROCm image is equally unusable on that host, and the CPU TEI embedder
saturates cores under concurrent ingest, so a vLLM instance can serve
``BAAI/bge-large-en-v1.5`` as a pooling model and answer the OpenAI shape
(``POST /v1/embeddings {model, input} → data[].embedding`` — spike-verified
live).

The contract, identical in shape to the reranker's:

* ``tei`` is the default on EVERY platform. When ``EMBEDDING_BACKEND`` is
  unset or ``tei``, this module is inert and the consumers' TEI paths run
  byte-identically — an NVIDIA deployment must not change at all. An
  unknown value falls back to ``tei`` with a warning, mirroring
  ``resolve_reranking_strategy()``.
* The vllm branch activates only when ``EMBEDDING_BACKEND=vllm`` AND
  ``EMBEDDING_VLLM_ENDPOINT`` is set. ``vllm`` with an empty endpoint is a
  misconfiguration, not a crash: the active-check fails soft to TEI and
  logs a warning naming the remedy.
* ``EMBEDDING_BACKEND=vllm`` with no endpoint configured never takes the
  retriever down at import or at request time.

The module is imported by all three consumers (retriever, dataprep), so it
stays import-light: only stdlib + ``core.model_http_policy`` (stdlib-only
itself) at module scope; ``langchain_openai`` is imported inside
:func:`build_vllm_embeddings` so a service that never activates the backend
never pays for the import (and an image that never activates it does not
need the package on the request path).
"""

import logging
import os

from core.model_http_policy import EMBEDDING_TIMEOUT_SECONDS, http_timeout

logger = logging.getLogger(__name__)

# The model the ROCm venue's vllm-embedding instance serves by default
# (compose: VLLM_EMBEDDING_MODEL_ID). A deployment can override the client
# side per process with EMBEDDING_MODEL_ID.
VLLM_EMBED_DEFAULT_MODEL = "BAAI/bge-large-en-v1.5"

_EMBEDDING_BACKENDS = ("tei", "vllm")

# Warn-once guards (code review, 2026-11-18): the retriever evaluates
# embeddings_backend_active() per request/per fan-out leg — without these,
# a misconfigured deployment warns at request rate instead of once.
_WARNED_UNKNOWN_BACKEND = False
_WARNED_MISSING_ENDPOINT = False


def resolve_embedding_backend(requested: str | None = None) -> str:
    """Return the embedding backend that will actually run.

    Reads ``EMBEDDING_BACKEND`` per call (the env is fixed at container
    start, so a re-read costs nothing measurable and keeps the value
    monkeypatchable in tests — the same decision the reranker's backend
    switch made). Unknown or empty names resolve to ``tei``: the default
    path must never move because of a typo.
    """
    global _WARNED_UNKNOWN_BACKEND
    raw = requested if requested is not None else os.getenv("EMBEDDING_BACKEND", "tei")
    backend = (raw or "tei").strip().lower()
    if backend not in _EMBEDDING_BACKENDS:
        if not _WARNED_UNKNOWN_BACKEND:
            logger.warning(f"EMBEDDING_BACKEND={backend[:32]} is not a known backend. Falling back to tei.")
            _WARNED_UNKNOWN_BACKEND = True
        return "tei"
    return backend


def embeddings_backend_active() -> bool:
    """True only when ``EMBEDDING_BACKEND=vllm`` AND the endpoint is set.

    ``vllm`` with an empty ``EMBEDDING_VLLM_ENDPOINT`` would otherwise
    surface as a confusing connection error at the first embedding call —
    fail soft here instead: the TEI path serves the request and one warning
    names the remedy.
    """
    global _WARNED_MISSING_ENDPOINT
    if resolve_embedding_backend() != "vllm":
        return False
    endpoint = (os.getenv("EMBEDDING_VLLM_ENDPOINT") or "").strip().rstrip("/")
    if not endpoint:
        if not _WARNED_MISSING_ENDPOINT:
            logger.warning(
                "EMBEDDING_BACKEND=vllm but EMBEDDING_VLLM_ENDPOINT is empty — "
                "falling back to the TEI embedding path. Set EMBEDDING_VLLM_ENDPOINT "
                "(e.g. http://vllm-embedding:8000) to activate the vLLM backend."
            )
            _WARNED_MISSING_ENDPOINT = True
        return False
    return True


def resolved_embed_model(default_model: str = VLLM_EMBED_DEFAULT_MODEL) -> str:
    """The model id the vLLM embeddings client sends, env override first.

    One definition for the builder and the consumers' log lines, so what a
    request sends and what the log reports cannot disagree. The fallback
    chain matches the serving side's own naming: EMBEDDING_MODEL_ID (client
    override) → VLLM_EMBEDDING_MODEL_ID (the compose var that names what
    the vllm-embedding instance serves — setting one without the other
    would otherwise 404 per request, code review finding 9) → the built-in
    default.
    """
    return os.getenv("EMBEDDING_MODEL_ID") or os.getenv("VLLM_EMBEDDING_MODEL_ID") or default_model


# Resolved once at import for parity with the retriever's config constants.
# The FUNCTIONS above re-read the env per call (Task-14 pattern); these two
# are the startup snapshot a reader of the process env expects to find.
EMBEDDING_BACKEND = resolve_embedding_backend()
EMBEDDING_VLLM_ENDPOINT = (os.getenv("EMBEDDING_VLLM_ENDPOINT") or "").strip().rstrip("/")


def build_vllm_embeddings(default_model: str = VLLM_EMBED_DEFAULT_MODEL):
    """An OpenAI-compatible embeddings client pointed at the vLLM endpoint.

    The caller has already checked :func:`embeddings_backend_active` — this
    builder does not re-check, it builds.

    * ``base_url`` gets the ``/v1`` suffix: vLLM answers the OpenAI routes
      under ``/v1/embeddings``.
    * ``check_embedding_ctx_length=False`` is REQUIRED. langchain's default
      tokenizes inputs with tiktoken (an OpenAI vocabulary) to chunk them to
      the model's context window; bge-large is not tiktoken-tokenizable and
      the mangling silently corrupts the vectors. The endpoint's own
      ``--max_model_len`` is the real bound (compose sizes it for the chunk
      size), and vLLM truncates or rejects on its own terms.
    * The timeout is the shared OpenAI-compatible embedding budget
      (``core/model_http_policy.EMBEDDING_TIMEOUT_SECONDS``, via
      ``http_timeout`` so the 5 s connect ceiling survives — a bare float
      would set connect to the full budget and lose the SDK's blackhole
      guard).
    * ``api_key`` falls back to ``"EMPTY"`` because a local vLLM without an
      API key requirement still expects the header shape; the compose files
      pass ``VLLM_API_KEY`` through wherever the backend can be active.

    ``langchain_openai`` is imported here, not at module scope: this module
    sits on the import path of every consumer, and the dataprep image does
    not carry the package on any path the default backend reaches.
    """
    from langchain_openai import OpenAIEmbeddings

    # Same per-call env read as the active-check, so the gate and the builder
    # can never disagree about the endpoint within one process.
    endpoint = (os.getenv("EMBEDDING_VLLM_ENDPOINT") or "").strip().rstrip("/")
    return OpenAIEmbeddings(
        model=resolved_embed_model(default_model),
        base_url=f"{endpoint}/v1",
        api_key=os.getenv("VLLM_API_KEY") or "EMPTY",
        check_embedding_ctx_length=False,
        timeout=http_timeout(EMBEDDING_TIMEOUT_SECONDS),
    )
