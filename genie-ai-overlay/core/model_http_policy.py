# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared HTTP budget policy for model-endpoint calls (LLM / TEI).

Every in-repo client that talks to a model endpoint derives its timeout and
retry budget from this module, so a heavily contended shared GPU fails
**bounded and uniformly** across services instead of per-site library defaults
drifting apart. Two call sites are outside it and named below: the vendored
``comps`` clients, and the retriever's ``HuggingFaceEndpointEmbeddings``, whose
pydantic field set depends on the pinned ``langchain-huggingface``.

Why a budget shorter than the library default is the safe choice: every LLM
caller in this overlay has a degradation path that produces a usable document
without the model — dataprep falls back batch → per-chunk → file labels, and
Contextual Retrieval falls back to the raw chunk. A request that has not
answered after minutes is not going to produce a better answer later; it is
going to delay the fallback that would have finished the ingest. So the budget
is set to *bound the delay*, not to *wait longer for a good answer*.

Precedence: ``MODEL_LLM_TIMEOUT_SECONDS`` > legacy ``VLLM_TIMEOUT`` (retriever
deployment knob) > default. Retries have no legacy name.

Scope — every in-repo call site (see the audit table below for what is NOT
here, and why):

============================  ==========================  ==============
service / site               client                      budget
============================  ==========================  ==============
dataprep  ``_build_vllm_client``  ``AsyncOpenAI``          LLM_*
dataprep  Keycloak token      ``aiohttp``                 CONTROL_PLANE_*
reranker  TEI ``/rerank``     ``aiohttp``                 TEI_*
retriever ``VLLM_TIMEOUT``    ``ChatOpenAI`` summarizer   LLM_*
retriever ``OpenAIEmbeddings``  ``langchain_openai``      TEI_*
retriever OpenAI ChatOpenAI   ``langchain_openai``       LLM_*
============================  ==========================  ==============

NOT covered — vendored ``comps``, which owns the HTTP calls outright and cannot
be configured from this repository:

* the chatqna RAG ``MicroService`` graph (embed → retrieve → rerank → LLM), and
* the dataprep graph-transformer (``LLMGraphTransformer`` inside
  ``OpeaArangoDataprep``, invoked once per ingested document).

The embedding and textgen images carry no Python at all — the TEI embedding
microservice and the streaming textgen path live entirely inside the upstream
``opea/*:1.5`` base images.

Closing that gap needs a change to the vendored source, tracked in
``OVERRIDES.yaml`` under ``comps.dataprep.…`` / ``comps.cores.mega.orchestrator…``
rather than a knob here. Docling document parsing is in-process CPU work on the
GPU node's own service, not a model call — no budget applies.
"""

import math
import os


def positive_float_env(*names: str, default: float) -> float:
    """Return the first env var among *names* that is *set* and parses validly.

    Precedence is by position in *names*: the first one SET wins, and a value
    that does not parse is rejected rather than skipped. Both halves matter.

    A garbage, non-positive or non-finite value falls back to *default*
    instead of raising or being honoured, because these knobs are read at
    import time and a typo must not take a service down:

    - ``0`` / a negative must not be accepted — a zero timeout is not "no
      timeout", it is an immediate failure on every call;
    - ``inf`` must not be rejected either way: it passes a ``> 0`` check and
      ``int(inf)`` then raises ``OverflowError`` at import.

    Rejecting rather than skipping is what keeps precedence honest. Continuing
    past a malformed value would let a lower-precedence name answer for a knob
    the operator set explicitly — ``MODEL_LLM_TIMEOUT_SECONDS=30m`` next to
    ``VLLM_TIMEOUT=600`` would quietly resolve to 600, and the container log
    would report a budget the .env never asked for.

    Services whose own configuration reads timings (dataprep's phase budgets)
    use this rather than a bare ``float(os.getenv(...))`` so they cannot
    disagree about that rule.
    """
    for name in names:
        raw = os.getenv(name)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            return default
        # isfinite before the comparison: NaN fails both, inf passes only the
        # lower bound.
        if math.isfinite(value) and value > 0:
            return value
    return default


def non_negative_int_env(*names: str, default: int) -> int:
    """Return the first env var among *names* parsing as a non-negative integer.

    A separate rule from ``positive_float_env`` because the two settings have
    different meanings for zero. A zero *timeout* is "fail immediately on every
    call" and must be rejected; a zero *retry count* is the meaningful value —
    an operator on a contended GPU setting ``MODEL_LLM_MAX_RETRIES=0`` to cap
    the worst-case latency of a batch is asking for precisely that, and routing
    it through the positive parser would silently give them the default back.

    Fractional values round up, so ``0.5`` becomes 1 rather than truncating to a
    retry count the operator did not ask for.

    Like ``positive_float_env``, a name that is set but malformed ends the
    search rather than yielding to the next name — otherwise a typo in the
    preferred knob is answered for by a lower-precedence one.
    """
    for name in names:
        raw = os.getenv(name)
        if raw is None or raw == "":
            continue
        try:
            value = float(raw)
        except ValueError:
            return default
        if math.isfinite(value) and value >= 0:
            return math.ceil(value)
    return default


# LLM (vLLM chat completions).
#
# 180 s, down from the openai-python default of 600 s, and deliberately so. The
# default is not a safety property: openai pairs it with 2 automatic retries,
# and three of this overlay's LLM call sites add their own 3-attempt loop on
# top — a worst case of ~30 min per batch with no log line, no span attribute
# and no fallback for the whole duration. Live-observed on a shared GPU: a
# 260-chunk ingest issued 65 batched labeling calls, and after 13 min none had
# returned and none had failed, because 13 min sits inside the first 600 s
# attempt. Every one of those calls had a fallback ready to go that the budget
# was keeping from ever running.
#
# 180 s is ~3x the observed p95 for a batched labeling call on an uncontended
# GPU, so healthy deployments keep their results and degraded ones fall back in
# minutes instead of half an hour. Deployments on a slower model raise it via
# MODEL_LLM_TIMEOUT_SECONDS.
LLM_TIMEOUT_SECONDS = positive_float_env("MODEL_LLM_TIMEOUT_SECONDS", "VLLM_TIMEOUT", default=180.0)

# openai-python retries twice by default: a 408/409/429/5xx response, a
# connection error, AND a request timeout (verified in _base_client.py — the
# httpx.TimeoutException handler consumes a retry when one remains, so the
# budget below is paid up to 3 times on a wedged endpoint). Left at 2 because
# the errors worth retrying are exactly the contention this deck sees: a
# saturated GPU answers 503 or drops the connection, and both clear on their
# own. Set MODEL_LLM_MAX_RETRIES=0 to cap the worst case instead.
LLM_MAX_RETRIES = non_negative_int_env("MODEL_LLM_MAX_RETRIES", default=2)

# TEI (rerank / embed): single-shot batch calls with short outputs, so a much
# tighter budget than chat generation. 120 s leaves room for queueing behind a
# shared GPU without treating normal contention as failure.
TEI_TIMEOUT_SECONDS = positive_float_env("MODEL_TEI_TIMEOUT_SECONDS", default=120.0)

# Control-plane calls (Keycloak token refresh, ingestion-log writes, doc status
# updates, taxonomy fetch). These are in-cluster HTTP services with no model
# work behind them — a slow one means something is wrong with the service, not
# that the answer is worth waiting for. 30 s covers a slow TLS handshake plus a
# slow handler; beyond that the caller is better off surfacing the failure.
CONTROL_PLANE_TIMEOUT_SECONDS = positive_float_env("MODEL_CONTROL_PLANE_TIMEOUT_SECONDS", default=30.0)
