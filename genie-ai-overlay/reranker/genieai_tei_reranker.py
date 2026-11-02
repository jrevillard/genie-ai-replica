# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import json
import math
import os
import statistics

import aiohttp
import numpy as np
from comps import CustomLogger, LLMParamsDoc, OpeaComponentRegistry, SearchedDoc
from comps.cores.proto.api_protocol import (
    ChatCompletionRequest,
    RerankingRequest,
    RerankingResponse,
    RerankingResponseData,
)

# Importing the base class from original OPEA
from integrations.tei import OpeaTEIReranking
from kneed import KneeLocator
from opentelemetry import propagate
from opentelemetry.trace import Status, StatusCode
from pydantic import Field

from core.pipeline_settings import load_settings
from tracing import get_tracer, setup_trace_logging

tracer = get_tracer(__name__)


# Defining a custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None
    embedding: list[float] = Field(default_factory=list)
    chunk_embeddings: list[list[float]] = Field(default_factory=list)


logger = CustomLogger("genie_tei_reranking")
setup_trace_logging("genie_tei_reranking")
logflag = os.getenv("LOGFLAG", False)

# Strategies: slice, threshold, slice_threshold, knee_threshold, adaptive
RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice")
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 3))
# knee_threshold fallback when no elbow exists on the score curve (Adem 10-22:
# no elbow → behave like slice with topN=2 — the cell that measured passage
# recall 0.833 vs 0.702 at topN=1).
# ponytail: constant, not a rag-tuning knob; promote to a knob if N.9's
# battery makes knee_threshold the production strategy.
_KNEE_NO_ELBOW_TOP_N = 2

# Adaptive utility-cost selection parameters
NOVELTY_SIGMOID_A = float(os.getenv("NOVELTY_SIGMOID_A", 20.0))
NOVELTY_SIGMOID_B = float(os.getenv("NOVELTY_SIGMOID_B", 0.25))
CONTEXT_DECAY_FACTOR = float(os.getenv("CONTEXT_DECAY_FACTOR", 0.0025))
MIN_VALUE_THRESHOLD = float(os.getenv("MIN_VALUE_THRESHOLD", -1.0))

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

# Enum fields validated against this module's exact strategy branch set.
_RAG_ENUMS = {
    ("retriever", "searchStart"): ("chunk", "edge", "node"),
    ("retriever", "searchMode"): ("vector", "hybrid"),
    ("retriever", "filterStrategy"): ("AND", "OR"),
    ("reranker", "strategy"): ("slice", "threshold", "knee_threshold", "slice_threshold", "adaptive"),
}

_rag_bad_ref = None  # last settings dict we already WARNed about (once-per-state guard)


def _rag_settings() -> dict:
    """Per-request RAG tuning (K.3): file values over :data:`_RAG_DEFAULTS`.

    K.1 never-crash law, typed-field leg (K.2's ``_llm_settings`` pattern):
    a PARSEABLE file with a wrong-typed or invalid-enum field WARNs once per
    file state and degrades the WHOLE document to the coded defaults — never
    a TypeError inside adaptive_context_selection's math.
    """
    settings = load_settings("RAG_TUNING_CONFIG", _RAG_DEFAULTS)

    def degrade(reason: str) -> dict:
        global _rag_bad_ref
        if settings is not _rag_bad_ref:
            _rag_bad_ref = settings
            logger.warning(
                f"rag-tuning {reason} — using coded defaults (K.1 never-crash law)"
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


# Helper functions for the adaptive strategy
def cosine_similarity(vec_a, vec_b):
    """Cosine similarity between two vectors (0.0 when either is zero-length)."""
    vec_a = np.array(vec_a, dtype=float)
    vec_b = np.array(vec_b, dtype=float)
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


def novelty_sigmoid(novelty, a=NOVELTY_SIGMOID_A, b=NOVELTY_SIGMOID_B):
    """Map a novelty score to a [0, 1] weight via a logistic curve."""
    return 1.0 / (1.0 + math.exp(-a * (novelty - b)))


def estimate_token_count(text):
    """Rough token estimate (~4 chars/token), floored to 1."""
    return max(1, len(text) / 4.0)


def adaptive_context_selection(texts, chunk_embeddings, query_embedding, reranker_scores):
    """Utility-cost context selection.

    Picks documents whose marginal value (utility minus cost) exceeds
    ``MIN_VALUE_THRESHOLD``. Utility = relevance * novelty-weight; cost =
    token cost + confusion cost. Candidates are processed in descending
    score order: the strongest match seeds the selected set, then each
    subsequent chunk is scored for marginal value against what is already
    selected.

    Callers MUST pass ``texts``, ``chunk_embeddings`` and ``reranker_scores``
    aligned to the same candidate order, with ``reranker_scores`` sorted
    descending (so ``reranker_scores[0]`` is the maximum).

    Returns:
        tuple[list[int], list[dict]]: ``(selected_indices, breakdown)`` where
        ``breakdown`` is a per-candidate record of every term in the
        utility-cost calculation (score, relevance, novelty, utility,
        token_count, confusion_cost, context_decay_cost, value, selected).
        The breakdown lets the eval harness / operators calibrate
        ``CONTEXT_DECAY_FACTOR`` and the confusion formula offline against
        real chunk sizes, without redeploying.
    """
    n = len(texts)
    breakdown: list[dict] = []
    if n == 0:
        return [], breakdown

    # K.3: the adaptive params resolve per request from rag-tuning.json
    # (file over _RAG_DEFAULTS). They MUST be read here, inside the call —
    # novelty_sigmoid's def-time default-arg binding (module constants)
    # makes global rebinds invisible to callers relying on the defaults,
    # so a/b are passed EXPLICITLY below (the signature-bake trap).
    _rr = _rag_settings()["reranker"]

    avg_score = statistics.mean(reranker_scores)
    median_score = statistics.median(reranker_scores)
    skew = (avg_score - median_score) / avg_score if avg_score != 0 else 0.0

    max_score = reranker_scores[0]  # caller passes scores sorted descending

    selected_indices = []

    for i in range(n):
        score = reranker_scores[i]

        # Relevance — boosts chunks whose score exceeds the (skew-adjusted) mean
        relevance = score + (score - avg_score * (1 + np.tanh(skew)))

        # Novelty — penalises redundancy with already-selected chunks
        if not selected_indices:
            novelty = 1.0
        else:
            best_similarity = -1.0
            best_selected_index = selected_indices[0]
            for j in selected_indices:
                similarity = cosine_similarity(chunk_embeddings[i], chunk_embeddings[j])
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_selected_index = j

            sim_i_q = cosine_similarity(chunk_embeddings[i], query_embedding)
            sim_j_q = cosine_similarity(chunk_embeddings[best_selected_index], query_embedding)
            delta_q = abs(sim_i_q - sim_j_q)

            novelty = 1 - best_similarity * (1 - delta_q)
            novelty = max(0.0, min(1.0, novelty))

        novelty_weight = novelty_sigmoid(
            novelty, a=_rr["noveltySigmoidA"], b=_rr["noveltySigmoidB"]
        )

        # Utility
        utility = relevance * novelty_weight

        # Token cost — each chunk consumes context-window budget
        token_count = estimate_token_count(texts[i])
        context_decay_cost = _rr["contextDecayFactor"] * token_count

        # Confusion cost — low-confidence chunks risk degrading the answer
        denominator = max_score - avg_score
        if abs(denominator) < 1e-6:
            denominator = 1e-6
        confusion_cost = (1 - score) + ((max_score - score) / denominator)

        # Total cost
        total_cost = context_decay_cost + confusion_cost

        # Marginal value
        value = utility - total_cost
        is_selected = value > _rr["minValueThreshold"]
        logger.info(
            f"[ADAPTIVE] idx={i} score={score:.4f} R={relevance:.4f} "
            f"N={novelty:.4f} U={utility:.4f} C={total_cost:.4f} V={value:.4f}"
        )
        # Record every term so the eval harness / operators can recalibrate
        # CONTEXT_DECAY_FACTOR and the confusion formula offline against real
        # chunk sizes. Emitted on the reranker span as rag.adaptive_breakdown.
        breakdown.append(
            {
                "idx": i,
                "score": round(score, 6),
                "relevance": round(float(relevance), 6),
                "novelty": round(novelty, 6),
                "novelty_weight": round(float(novelty_weight), 6),
                "utility": round(float(utility), 6),
                "token_count": int(token_count),
                "context_decay_cost": round(float(context_decay_cost), 6),
                "confusion_cost": round(float(confusion_cost), 6),
                "total_cost": round(float(total_cost), 6),
                "value": round(float(value), 6),
                "selected": bool(is_selected),
            }
        )
        if is_selected:
            selected_indices.append(i)

    return selected_indices, breakdown


@OpeaComponentRegistry.register("GENIE_TEI_RERANKING")
class GenieTEIReranking(OpeaTEIReranking):
    """
    GENIE.AI Extension of OpeaTEIReranking
    Adds: Multi-strategy reranking (slice, threshold, knee_threshold)
    """

    async def invoke(
        self, input: GenieSearchedDoc | RerankingRequest | ChatCompletionRequest
    ) -> LLMParamsDoc | RerankingResponse | ChatCompletionRequest:
        """Invokes the reranking service to generate rerankings for the provided input."""

        # Testing optimisation
        # Extract parameters dynamically from request payload to support
        # automated testing sweeps via ChatQnA
        input_dict = (
            input.model_dump(exclude_none=True)
            if hasattr(input, "model_dump")
            else getattr(input, "dict", lambda: {})()
        )
        logger.info(f"[ DEBUG - VERBOSE ] RERANKER INPUT: {input_dict}")

        reranking_results = []
        reranking_strategy = input_dict.get("reranking_strategy", RERANKING_STRATEGY)
        reranking_threshold = input_dict.get("reranking_threshold", RERANKING_THRESHOLD)
        reranker_top_n = input_dict.get("top_n", RERANKER_TOP_N)
        input_doc_count = len(input.retrieved_docs) if input.retrieved_docs else 0

        with tracer.start_as_current_span("reranker.tei_invoke") as span:
            span.set_attribute("reranker.strategy", reranking_strategy)
            span.set_attribute("reranker.top_n", reranker_top_n)
            span.set_attribute("reranker.score_threshold", reranking_threshold)
            reranker_model_id = os.getenv("RERANKER_MODEL_ID", os.getenv("TEI_RERANKING_ENDPOINT", ""))
            span.set_attribute("reranker.model_id", reranker_model_id)
            span.set_attribute("reranker.input_doc_count", input_doc_count)

            if input.retrieved_docs:
                docs = [doc.text for doc in input.retrieved_docs]
                query = input.initial_query if isinstance(input, SearchedDoc) else input.input

                # Propagate trace context to TEI
                headers = {}
                propagate.inject(headers)

                try:
                    async with (
                        aiohttp.ClientSession() as session,
                        session.post(
                            f"{self.base_url}/rerank",
                            json={"query": query, "texts": docs},
                            headers=headers,
                        ) as resp,
                    ):
                        decoded_response = await resp.json()
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                    raise

                # Validate the TEI response contract before consuming it. TEI returns
                # HTTP 200 + a list of {"index": int, "score": float} on success. On
                # failure (e.g. 429 "Model is overloaded", 5xx), it returns a JSON
                # error OBJECT like {"error": "...", "error_type": "Overloaded"}.
                # Without this guard, iterating the error object yields its string
                # keys, and `r["index"]` later raises a confusing
                # "TypeError: string indices must be integers" that hides the real
                # upstream failure. Fail loudly with the actual TEI status + body.
                if resp.status != 200:
                    span.set_status(
                        Status(
                            StatusCode.ERROR,
                            f"TEI reranker returned HTTP {resp.status}: {decoded_response}",
                        )
                    )
                    raise RuntimeError(
                        f"TEI reranker call failed: HTTP {resp.status} from "
                        f"{self.base_url}/rerank (ndocs={len(docs)}). "
                        f"Response: {decoded_response}"
                    )
                if not isinstance(decoded_response, list):
                    span.set_status(
                        Status(
                            StatusCode.ERROR,
                            f"TEI reranker returned non-list response: {type(decoded_response).__name__}",
                        )
                    )
                    raise RuntimeError(
                        f"TEI reranker returned an unexpected response type "
                        f"{type(decoded_response).__name__} (expected list of "
                        "{{index, score}} dicts). HTTP was 200 but body is not the "
                        f"scored-list contract. Response: {decoded_response}"
                    )
                if len(decoded_response) != len(docs):
                    logger.warning(
                        f"TEI reranker returned {len(decoded_response)} scores for "
                        f"{len(docs)} input docs — counts differ. Scores may not "
                        f"align with retrieved_docs."
                    )

                # Checking reranking_strategy param value:
                logger.info(f"[ DEBUG ] Selected RERANKING STRATEGY is {reranking_strategy}")

                if reranking_strategy == "slice":
                    top_n = reranker_top_n if reranker_top_n else 1
                    for best_response in decoded_response[:top_n]:
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )

                elif reranking_strategy == "threshold":
                    document_scores = [r["score"] for r in decoded_response]
                    logger.info(f"[ DEBUG ] Reranked document scores {document_scores}")
                    for best_response in decoded_response:
                        if best_response["score"] >= reranking_threshold:
                            reranking_results.append(
                                {
                                    "text": input.retrieved_docs[best_response["index"]].text,
                                    "score": best_response["score"],
                                }
                            )

                elif reranking_strategy == "knee_threshold":
                    document_scores = [r["score"] for r in decoded_response]
                    logger.info(f"[ DEBUG ] Reranked document scores {document_scores}")
                    indices = list(range(len(document_scores)))

                    kneedle = KneeLocator(indices, document_scores, curve="convex", direction="decreasing")

                    # If a knee is found, slice up to the knee + 1. No elbow on a flat
                    # score curve: fall back to slice-style top _KNEE_NO_ELBOW_TOP_N
                    # (best-2 — the measured-best cell) instead of keeping everything.
                    cutoff = (
                        kneedle.knee + 1
                        if kneedle.knee is not None
                        else min(_KNEE_NO_ELBOW_TOP_N, len(document_scores))
                    )

                    for i in range(cutoff):
                        best_response = decoded_response[i]
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )

                elif reranking_strategy == "slice_threshold":
                    # Top-N, but only chunks scoring at/above the threshold.
                    # decoded_response is pre-sorted descending by TEI, so we can
                    # break as soon as a score drops below the threshold.
                    top_n = reranker_top_n if reranker_top_n else 1
                    for best_response in decoded_response:
                        if best_response["score"] >= reranking_threshold:
                            reranking_results.append(
                                {
                                    "text": input.retrieved_docs[best_response["index"]].text,
                                    "score": best_response["score"],
                                }
                            )
                            if len(reranking_results) >= top_n:
                                break
                        else:
                            break

                elif reranking_strategy == "adaptive":
                    query_embedding = input.embedding if isinstance(getattr(input, "embedding", None), list) else []
                    chunk_embeddings = input.chunk_embeddings if hasattr(input, "chunk_embeddings") else []

                    embeddings_valid = (
                        bool(query_embedding)
                        and len(chunk_embeddings) == len(input.retrieved_docs)
                        and all(isinstance(ce, list) and len(ce) > 0 for ce in chunk_embeddings)
                    )

                    if not embeddings_valid:
                        # Hard-fail: adaptive has no legitimate graceful-degradation
                        # case (if the embedding service is down, the whole RAG
                        # pipeline fails regardless). Raise rather than silently
                        # degrading to slice, which masks integration errors.
                        msg = (
                            "[ADAPTIVE] Cannot run adaptive reranking — embeddings missing "
                            f"or misaligned (query_embedding={'present' if query_embedding else 'missing'}, "
                            f"chunk_embeddings={len(chunk_embeddings)} vs docs={len(input.retrieved_docs)}). "
                            "Fix the embedding propagation chain (retriever -> chatqna) before using adaptive."
                        )
                        logger.error(msg)
                        span.set_status(Status(StatusCode.ERROR, msg))
                        raise RuntimeError(msg)
                    else:
                        # decoded_response is TEI score-sorted descending, each with
                        # an 'index' pointing back to its original position in
                        # retrieved_docs. Reorder texts + chunk_embeddings into the
                        # same score-sorted order so each candidate's text, embedding
                        # and score stay aligned for the selector.
                        ranked_texts = [input.retrieved_docs[r["index"]].text for r in decoded_response]
                        ranked_chunk_embeddings = [chunk_embeddings[r["index"]] for r in decoded_response]
                        ranked_scores = [r["score"] for r in decoded_response]

                        selected_positions, adaptive_breakdown = adaptive_context_selection(
                            texts=ranked_texts,
                            chunk_embeddings=ranked_chunk_embeddings,
                            query_embedding=query_embedding,
                            reranker_scores=ranked_scores,
                        )
                        # Annotate each breakdown record with its ORIGINAL index in
                        # retrieved_docs (== the order chatqna emits in the
                        # rag.candidate_chunk_keys span attribute). Without this,
                        # the offline calibrator can't map a breakdown position
                        # (TEI rank order) back to a candidate content hash to
                        # score recall. ranked position i -> decoded_response[i]
                        # -> ["index"] -> retrieved_docs position.
                        for rank_pos, rec in enumerate(adaptive_breakdown):
                            rec["original_index"] = int(decoded_response[rank_pos]["index"])
                        logger.info(f"[ADAPTIVE] Selected candidate positions: {selected_positions}")
                        # Emit the full per-candidate utility-cost breakdown so the
                        # eval harness / operators can recalibrate CONTEXT_DECAY_FACTOR
                        # and the confusion formula offline against real chunk sizes.
                        # JSON-encoded (array attribute); consumed by run_eval.py.
                        span.set_attribute(
                            "rag.adaptive_breakdown",
                            json.dumps(adaptive_breakdown),
                        )
                        # K.3: emit the PER-REQUEST file values the selection
                        # actually used (not the boot env constants), so the
                        # offline calibrator can attribute outcomes to edits.
                        _rr_span = _rag_settings()["reranker"]
                        span.set_attribute("rag.adaptive_context_decay_factor", _rr_span["contextDecayFactor"])
                        span.set_attribute("rag.adaptive_min_value_threshold", _rr_span["minValueThreshold"])

                        for pos in selected_positions:
                            original_index = decoded_response[pos]["index"]
                            reranking_results.append(
                                {
                                    "text": input.retrieved_docs[original_index].text,
                                    "score": decoded_response[pos]["score"],
                                }
                            )

                else:
                    logger.warning(f"Unknown strategy {reranking_strategy}. Defaulting to slice.")
                    for best_response in decoded_response[:reranker_top_n]:
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )

            span.set_attribute("reranker.output_doc_count", len(reranking_results))

            # Checking reranker output composition
            logger.info(f"[ DEBUG ] Total number of documents in reranker output: {len(reranking_results)}")

            reranking_docs = [RerankingResponseData(text=doc["text"], score=doc["score"]) for doc in reranking_results]

            if isinstance(input, SearchedDoc):
                # 2. Return the RerankingResponse (preserves scores) instead of LLMParamsDoc (deletes scores)
                result = RerankingResponse(reranked_docs=reranking_docs)
                if logflag:
                    logger.info(result)
                return result

            else:
                if isinstance(input, RerankingRequest):
                    result = RerankingResponse(reranked_docs=reranking_docs)
                    if logflag:
                        logger.info(result)
                    return result

                if isinstance(input, ChatCompletionRequest):
                    input.reranked_docs = reranking_docs
                    input.documents = [doc["text"] for doc in reranking_results]
                    if logflag:
                        logger.info(input)
                    return input
