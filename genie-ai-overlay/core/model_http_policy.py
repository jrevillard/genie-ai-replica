# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared HTTP budget policy for model-endpoint calls (LLM / TEI).

Every in-repo client that talks to a model endpoint derives its timeout and
retry budget from this module, so a heavily contended shared GPU fails
**bounded and uniformly** across services instead of per-site library defaults
drifting apart. What is outside it, and why, is named at the bottom of this
docstring.

Why a budget shorter than the library default is the safe choice: every LLM
caller in this overlay has a degradation path that produces a usable document
without the model — dataprep falls back batch → per-chunk → file labels, and
Contextual Retrieval falls back to the raw chunk. A request that has not
answered after minutes is not going to produce a better answer later; it is
going to delay the fallback that would have finished the ingest. So the budget
is set to *bound the delay*, not to *wait longer for a good answer*.

Precedence: ``MODEL_LLM_TIMEOUT_SECONDS`` > legacy ``VLLM_TIMEOUT`` > default.
Retries have no legacy name. ``VLLM_TIMEOUT`` is a second name for the same
knob, kept so an existing ``.env`` carrying it keeps working; in a deployed
service ``MODEL_LLM_TIMEOUT_SECONDS`` is always injected, so the second tier is
never reached. It reaches no container at all now — the one vendored reader of
that name cannot use an env string as a timeout, see ``OVERRIDES.yaml``.

Scope — every in-repo call site (see the audit table below for what is NOT
here, and why):

============================  ==========================  ==============
service / site               client                      budget
============================  ==========================  ==============
dataprep  ``_build_vllm_client``  ``AsyncOpenAI``          LLM_* (timeout + retries)
dataprep  Keycloak token, ingestion-log writes, doc status,
          guardrail calls   ``aiohttp``                 CONTROL_PLANE_*
reranker  TEI ``/rerank``     ``aiohttp``                 RERANK_*
chatqna   backend user profile, document-repository metadata  ``aiohttp``  CONTROL_PLANE_*
retriever document summarizer ``ChatOpenAI``  ``langchain_openai``  SUMMARIZER_*
retriever OpenAI API key probe  ``openai.OpenAI``          LLM_* (timeout only)
retriever ``OpenAIEmbeddings``  ``langchain_openai``      EMBEDDING_*
retriever ``HuggingFaceEndpointEmbeddings`` (TEI branch)  —  UNBUDGETED
============================  ==========================  ==============

NOT covered — vendored ``comps``, which owns the HTTP calls outright and cannot
be configured from this repository:

* the chatqna RAG ``MicroService`` graph (embed → retrieve → rerank → LLM), and
* the dataprep graph-transformer (``LLMGraphTransformer`` inside
  ``OpeaArangoDataprep``, invoked once per ingested document).

The embedding and textgen images carry no overlay code at all — the TEI embedding
microservice and the streaming textgen path live entirely inside the upstream
``opea/*:1.5`` base images.

Closing that gap needs a change to the vendored source, tracked in
``OVERRIDES.yaml`` under ``comps.dataprep.…`` / ``comps.cores.mega.orchestrator…``
rather than a knob here.

Two in-repo clients reach a model endpoint without a budget from this module,
both for a library reason rather than an oversight:

* ``HuggingFaceEndpointEmbeddings`` (retriever, remote-GPU branch) — a pydantic
  model whose accepted fields follow the pinned langchain-huggingface, so an
  unrecognised ``timeout`` raises at construction;
* ``HuggingFaceBgeEmbeddings`` (retriever, local branch) — runs the embedding
  model in-process, so there is no HTTP hop to bound.

Docling parsing is also out of scope here: it is a remote ``docling-serve`` call,
but it is a document-conversion service rather than a model endpoint, and it
already carries its own ``DOCLING_ENDPOINT_TIMEOUT`` budget.
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
    - ``inf`` must be rejected explicitly, not merely by the ``> 0`` test: it
      passes that one, and ``math.ceil(inf)`` on the sibling integer parser
      raises ``OverflowError`` while the module is still being imported.

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
        # Parsed but out of range. This ends the search like an unparsable value
        # does, rather than falling through to the next name: `MODEL_LLM_TIMEOUT_
        # SECONDS=0` is an operator who said something, and answering them with
        # `VLLM_TIMEOUT` would report a budget they never asked for.
        return default
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
    return default


# LLM (vLLM chat completions).
#
# 180 s, down from the openai-python default of 600 s, and deliberately so. The
# default is not a safety property: openai pairs it with 2 automatic retries,
# and three of this overlay's LLM call sites add their own 3-attempt loop on
# top, so the two compose: 3 x (1 + 2) x 600 = 5400 s, a worst case of ~90 min
# per batch, with no log line, no span attribute and no fallback for the whole
# duration. Live-observed on a shared GPU: a
# 260-chunk ingest issued 65 batched labeling calls, and after 13 min none had
# returned and none had failed, because 13 min sits inside the first 600 s
# attempt. Every one of those calls had a fallback ready to go that the budget
# was keeping from ever running.
#
# 180 s is roughly 3x the p95 for a batched labelling call measured on an
# uncontended GPU. That is an OBSERVATION from a validation run, not a figure
# derived from anything in this repository — no benchmark artifact pins it, and
# it is stated here so the margin can be re-checked rather than trusted. If it
# holds, healthy deployments keep their results and degraded ones fall back in
# minutes instead of the ~90 min computed above. A deployment on a slower model should raise
# it via MODEL_LLM_TIMEOUT_SECONDS, and the phase ceiling with it.
LLM_TIMEOUT_SECONDS = positive_float_env("MODEL_LLM_TIMEOUT_SECONDS", "VLLM_TIMEOUT", default=180.0)

# openai-python retries twice by default: a 408/409/429/5xx response, a
# connection error, AND a request timeout (verified in _base_client.py — the
# httpx.TimeoutException handler consumes a retry when one remains, so the
# budget below is paid up to 3 times on a wedged endpoint). Left at 2 because
# the errors worth retrying are exactly the contention this deck sees: a
# saturated GPU answers 503 or drops the connection, and both clear on their
# own. Set MODEL_LLM_MAX_RETRIES=0 to cap the worst case instead.
LLM_MAX_RETRIES = non_negative_int_env("MODEL_LLM_MAX_RETRIES", default=2)

# The dataprep service-account token fetch. Its own budget rather than
# CONTROL_PLANE_*, and the distinction is load-bearing: the control-plane
# clients write the ingestion log and the document status, and losing one of
# those calls costs a log line. This one is a credential every one of those
# writes depends on — a single attempt, no retry, and the caller re-raises on
# failure, so there is no degradation route at all. Shortening it would be the
# reranker mistake on a path with more blast radius, and a slow-to-start
# Keycloak would fail the ingest rather than retry.
#
# 300 s is exactly what aiohttp's default total already was, so this knob
# changes no behaviour: it makes an inherited default visible and adjustable
# instead of accidental. Raise it for a Keycloak that is slow under load.
AUTH_TIMEOUT_SECONDS = positive_float_env("MODEL_AUTH_TIMEOUT_SECONDS", default=300.0)

# The retriever's document summarizer, a ChatOpenAI with no fallback: its
# except clause degrades only vLLM input overflow and re-raises everything
# else, so a timeout propagates out of retrieve() and the microservice maps it
# to a 500 on the user's chat request.
#
# Its budget is therefore the openai default, 600 s, and is NOT lowered to
# LLM_TIMEOUT_SECONDS — the exact defect round six found and fixed on the
# reranker, which would have been repeated here. Shortening a no-fallback call
# below the value the library already applies does not bound a stall, it
# converts a slow-but-successful summarization into a visible error. The knob
# exists so a deployment that wants a hard ceiling can set one deliberately.
SUMMARIZER_TIMEOUT_SECONDS = positive_float_env("MODEL_SUMMARIZER_TIMEOUT_SECONDS", default=600.0)

# Embedding, on the retriever's OpenAI-compatible embedding client. Named for
# what it bounds rather than for TEI: the TEI branch is
# HuggingFaceEndpointEmbeddings, which is left unbudgeted on purpose (pydantic
# field set), so a knob called MODEL_TEI_TIMEOUT_SECONDS would describe a path
# it does not reach. 120 s leaves room for queueing behind a shared endpoint
# without treating normal contention as failure.
#
# Read the exemption carefully: the unbudgeted branch is the REMOTE one. Its
# condition is `TEI_EMBEDDING_ENDPOINT and HF_TOKEN` — a remote endpoint plus a
# Hub token — so on exactly the deployment that produced the original stall this
# knob does NOT apply and the embedding call is unbounded.
# MODEL_EMBEDDING_TIMEOUT_SECONDS covers the OpenAI-API branch only.
#
# No degradation route here, unlike the labelling budgets. A timeout on this
# client is caught by the retriever and returns an EMPTY result set — not a
# sparse/BM25 fallback, because the `return []` short-circuits before the hybrid
# leg is ever reached. So hitting this budget costs the retrieval entirely, and
# surfaces as one logger.error line and a silently empty answer.
#
# That makes it the same shape as the reranker, and it is bounded for the same
# reason: it was previously unbounded, not because failing cheap is available.
# Raise it for a slow endpoint rather than lowering it.
EMBEDDING_TIMEOUT_SECONDS = positive_float_env("MODEL_EMBEDDING_TIMEOUT_SECONDS", default=120.0)

# TEI RERANK is budgeted separately and, at its default, no tighter than the
# 300 s aiohttp would have applied anyway — deliberately.
#
# Three budgets in this module sit on calls with no degradation route, and they
# are treated the same way: bounded, configurable, and NOT tightened below what
# the library already applied.
#
#   reranker    timeout propagates out of `invoke`; microservice maps it to a
#               500 and the chat request fails.
#   embedding   timeout is caught and returns an EMPTY result set; the
#               `return []` short-circuits before the BM25 leg, so there is no
#               sparse fallback — one logger.error and a silently empty answer.
#   summarizer  timeout propagates out of retrieve(); microservice maps it to a
#               500.
#
# For each, a short budget does not bound a stall gracefully — it converts a
# slow-but-successful call into a visible error or a silent empty result. That
# is a regression, not a fix. The budget still exists: it turns an unbounded wait
# into a bounded failure, which is better than neither. What it must not do is
# fail faster than the library already would. Lower any of the three
# deliberately, not by default, once its path has a degradation route.
#
# Everything else in this module does sit on a call that degrades: dataprep's
# labelling falls back to file labels, Contextual Retrieval to the raw chunk,
# the control-plane calls to a logged failure.
RERANK_TIMEOUT_SECONDS = positive_float_env("MODEL_RERANK_TIMEOUT_SECONDS", default=300.0)

# Control-plane calls (Keycloak token refresh, ingestion-log writes, doc status
# updates, taxonomy fetch). These are in-cluster HTTP services with no model
# work behind them — a slow one means something is wrong with the service, not
# that the answer is worth waiting for. 30 s covers a slow TLS handshake plus a
# slow handler; beyond that the caller is better off surfacing the failure.
CONTROL_PLANE_TIMEOUT_SECONDS = positive_float_env("MODEL_CONTROL_PLANE_TIMEOUT_SECONDS", default=30.0)


# The connect ceiling the OpenAI SDK ships: openai 1.81.0 sets
# DEFAULT_TIMEOUT = httpx.Timeout(timeout=600, connect=5.0), so a peer that
# blackholes SYNs — a powered-off host, a DROP rule, a network partition — is
# given up on in 5 s rather than sitting on Linux's ~127 s tcp_syn_retries
# budget. It matters here because the endpoint is a separate GPU node: the most
# common failure is the node going away mid-ingest.
CONNECT_TIMEOUT_SECONDS = 5.0


def http_timeout(total_seconds: float):
    """An ``httpx.Timeout`` carrying *total_seconds* but a 5 s connect ceiling.

    Handing an OpenAI-compatible client a bare float does NOT shorten one
    timeout — it replaces the whole ``httpx.Timeout`` object, so a float of
    ``total_seconds`` sets connect to *total_seconds* too and the SDK's 5 s
    ceiling is discarded along with it. On a blackholed GPU node that turns a
    ~15 s give-up into ~9 minutes of connect waiting per batch task, which is
    the exact stall a total budget exists to bound.

    Imported lazily: this module is read by every service in the overlay and
    importing it must not be able to kill one, so a service that never builds an
    httpx client never needs httpx installed.
    """
    import httpx

    return httpx.Timeout(total_seconds, connect=min(CONNECT_TIMEOUT_SECONDS, total_seconds))
