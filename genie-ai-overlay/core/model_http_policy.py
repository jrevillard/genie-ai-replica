# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared HTTP budget policy for model-endpoint calls (LLM / TEI).

Every in-repo client that talks to a model endpoint (vLLM chat completions,
TEI rerank/embed) derives its timeout and retry budget from this module, so a
heavily contended shared GPU fails **bounded and uniformly** across services
instead of per-site library defaults drifting apart (live-observed: the
openai-python default 600 s made dataprep labeling look like an infinite
silent stall, while reranker's bare ``aiohttp.ClientSession()`` silently
inherited aiohttp's 300 s default).

Precedence: ``MODEL_LLM_TIMEOUT_SECONDS`` > legacy ``VLLM_TIMEOUT`` (retriever
deployment knob) > default. Retries have no legacy name.

Scope — in-repo call sites only:

* dataprep  ``_build_vllm_client`` (labeling + contextual retrieval)
* reranker  TEI ``/rerank`` session
* retriever ``VLLM_TIMEOUT`` (ChatOpenAI summarizer)

NOT covered (vendored ``comps`` — needs an OVERRIDES.yaml entry to change):
the chatqna RAG ``MicroService`` graph (embed → retrieve → rerank → LLM),
the dataprep graph-transformer (sync ChatOpenAI in ``OpeaArangoDataprep``)
and the embedding/textgen TEI wrappers. Docling document parsing is
in-process CPU work, not an HTTP call — no budget applies.
"""

import os


def _positive_float(*names: str, default: float) -> float:
    """Return the first env var among *names* parsing as a positive float."""
    for name in names:
        raw = os.getenv(name)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if value > 0:
            return value
    return default


def _positive_int(*names: str, default: int) -> int:
    return int(_positive_float(*names, default=default))


# LLM (vLLM chat completions): generation latency scales with output length,
# so the budget is generous. Deployments on a heavily shared GPU can tighten
# it; the dataprep fallback chain (batch -> per-chunk -> file labels) keeps
# ingestion alive either way.
LLM_TIMEOUT_SECONDS = _positive_float("MODEL_LLM_TIMEOUT_SECONDS", "VLLM_TIMEOUT", default=600.0)
LLM_MAX_RETRIES = _positive_int("MODEL_LLM_MAX_RETRIES", default=2)

# TEI (rerank / embed): single-shot batch calls with short outputs — a much
# tighter budget than chat generation. 120 s leaves room for queueing behind
# a shared GPU without treating normal contention as failure.
TEI_TIMEOUT_SECONDS = _positive_float("MODEL_TEI_TIMEOUT_SECONDS", default=120.0)
