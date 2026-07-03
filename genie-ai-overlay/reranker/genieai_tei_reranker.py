# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

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
RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "adaptive")
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 1))

# Adaptive utility-cost selection parameters
NOVELTY_SIGMOID_A = float(os.getenv("NOVELTY_SIGMOID_A", 20.0))
NOVELTY_SIGMOID_B = float(os.getenv("NOVELTY_SIGMOID_B", 0.25))
CONTEXT_DECAY_FACTOR = float(os.getenv("CONTEXT_DECAY_FACTOR", 0.0025))
MIN_VALUE_THRESHOLD = float(os.getenv("MIN_VALUE_THRESHOLD", -1.0))


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
        list[int]: Selected candidate indices (positions in the input arrays).
    """
    n = len(texts)
    if n == 0:
        return []

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

        novelty_weight = novelty_sigmoid(novelty)

        # Utility
        utility = relevance * novelty_weight

        # Token cost — each chunk consumes context-window budget
        token_count = estimate_token_count(texts[i])
        context_decay_cost = CONTEXT_DECAY_FACTOR * token_count

        # Confusion cost — low-confidence chunks risk degrading the answer
        denominator = max_score - avg_score
        if abs(denominator) < 1e-6:
            denominator = 1e-6
        confusion_cost = (1 - score) + ((max_score - score) / denominator)

        # Total cost
        total_cost = context_decay_cost + confusion_cost

        # Marginal value
        value = utility - total_cost
        logger.info(
            f"[ADAPTIVE] idx={i} score={score:.4f} R={relevance:.4f} "
            f"N={novelty:.4f} U={utility:.4f} C={total_cost:.4f} V={value:.4f}"
        )
        if value > MIN_VALUE_THRESHOLD:
            selected_indices.append(i)

    return selected_indices


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
                        # [DEBUG-K20] capture TEI response shape to diagnose line 307 TypeError
                        import json as _json
                        logger.info(
                            f"[DEBUG-K20] TEI http={resp.status} ct={resp.headers.get('Content-Type')} "
                            f"ndocs={len(docs)} resp_type={type(decoded_response).__name__} "
                            f"resp_repr={_json.dumps(decoded_response)[:600] if not isinstance(decoded_response,(bytes,bytearray)) else repr(decoded_response)[:600]}"
                        )
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                    raise

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

                    # If a knee is found, slice up to the knee + 1. Otherwise, keep all.
                    cutoff = kneedle.knee + 1 if kneedle.knee is not None else len(document_scores)

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

                        selected_positions = adaptive_context_selection(
                            texts=ranked_texts,
                            chunk_embeddings=ranked_chunk_embeddings,
                            query_embedding=query_embedding,
                            reranker_scores=ranked_scores,
                        )
                        logger.info(f"[ADAPTIVE] Selected candidate positions: {selected_positions}")

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
