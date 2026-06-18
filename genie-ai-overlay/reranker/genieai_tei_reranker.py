# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os
import math
import statistics
import numpy as np

import aiohttp
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
from pydantic import Field


# Defining a custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None
    query_embedding: list[float] = Field(default_factory=list)
    chunk_embeddings: list[list[float]] = Field(default_factory=list)


logger = CustomLogger("genie_tei_reranking")
logflag = os.getenv("LOGFLAG", False)

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice")  # slice, threshold, slice_threshold, knee_threshold, adaptive
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 1))

# ADAPTIVE UTILITY-COST SELECTION PARAMS 
# Note: maybe can fully externalise at a later stage
# for now can configure through defaults...
NOVELTY_SIGMOID_A = float(os.getenv("NOVELTY_SIGMOID_A", 20.0))
NOVELTY_SIGMOID_B = float(os.getenv("NOVELTY_SIGMOID_B", 0.25))
TOKEN_COST_ALPHA = float(os.getenv("TOKEN_COST_ALPHA", 0.0025)) 
MIN_VALUE_THRESHOLD = float(os.getenv("MIN_VALUE_THRESHOLD", 0.0)) # optional, but maybe useful to have


# HELPER FUNCTIONS 
def cosine_similarity(vec_a, vec_b):
    vec_a = np.array(vec_a)
    vec_b = np.array(vec_b)
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))

def novelty_sigmoid(novelty, a=NOVELTY_SIGMOID_A, b=NOVELTY_SIGMOID_B):
    return 1.0 / (1.0 + math.exp(-a * (novelty - b)))

def estimate_token_count(text):
    return max(1, len(text) / 4.0)


# ADAPTIVE UTILITY-COST SELECTION LOGIC:
def adaptive_context_selection(
    texts,
    chunk_embeddings,
    query_embedding,
    reranker_scores,
    ):
    """
    Utility-Cost Context Selection.
    Selects documents by estimating and comparing their Utility and Cost

    Returns:
        list[int] selected indices
    """

    n = len(texts)

    if n == 0:
        return []

    avg_score = statistics.mean(reranker_scores)
    median_score = statistics.median(reranker_scores)

    skew = (
        (avg_score - median_score) / avg_score
        if avg_score != 0
        else 0.0
    )

    max_score = reranker_scores[0]

    selected_indices = []

    for i in range(n):
        score = reranker_scores[i]


        # Relevance
        relevance = (
            score + (score-avg_score+skew)
        )


        # Novelty
        if not selected_indices:
            novelty = 1.0

        else:
            best_similarity = -1.0
            best_selected_index = None

            for j in selected_indices:

                similarity = cosine_similarity(
                    chunk_embeddings[i],
                    chunk_embeddings[j],
                )

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_selected_index = j

            sim_i_q = cosine_similarity(
                chunk_embeddings[i],
                query_embedding,
            )

            sim_j_q = cosine_similarity(
                chunk_embeddings[best_selected_index],
                query_embedding,
            )

            delta_q = abs(sim_i_q - sim_j_q)

            novelty = (
                1
                - best_similarity * (1 - delta_q)
            )

            novelty = max(0.0, min(1.0, novelty))

        novelty_weight = novelty_sigmoid(novelty)


        # Utility
        utility = relevance * novelty_weight


        # Token cost
        token_count = estimate_token_count(texts[i])
        token_cost = TOKEN_COST_ALPHA * token_count


        # Confusion cost
        denominator = (
            max_score-avg_score+skew
        )

        if abs(denominator) < 1e-6:
            denominator = 1e-6

        confusion_cost = (
            (1 - score)
            +
            (
                (max_score - score)
                / denominator
            )
        )


        # Total cost
        total_cost = (
            token_cost
            + confusion_cost
        )


        # Marginal value
        value = utility - total_cost

        logger.info(
            f"[ADAPTIVE] "
            f"idx={i} "
            f"score={score:.4f} "
            f"R={relevance:.4f} "
            f"N={novelty:.4f} "
            f"U={utility:.4f} "
            f"C={total_cost:.4f} "
            f"V={value:.4f}"
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

        if input.retrieved_docs:
            docs = [doc.text for doc in input.retrieved_docs]
            query = input.initial_query if isinstance(input, SearchedDoc) else input.input

            async with (
                aiohttp.ClientSession() as session,
                session.post(f"{self.base_url}/rerank", json={"query": query, "texts": docs}) as resp,
            ):
                decoded_response = await resp.json()

            # Checking reranking_strategy param value:
            logger.info(f"[ DEBUG ] Selected RERANKING STRATEGY is {reranking_strategy}")

            if reranking_strategy == "slice":
                top_n = reranker_top_n if reranker_top_n else 1
                for best_response in decoded_response[:top_n]:
                    reranking_results.append(
                        {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                    )

            elif reranking_strategy == "threshold":
                document_scores = [resp["score"] for resp in decoded_response]
                logger.info(f"[ DEBUG ] Reranked document scores {document_scores}")
                for best_response in decoded_response:
                    if best_response["score"] >= reranking_threshold:
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )

            elif reranking_strategy == "knee_threshold":
                document_scores = [resp["score"] for resp in decoded_response]
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
                top_n = reranker_top_n if reranker_top_n else 1
                for best_response in decoded_response:
                    if best_response["score"] >= reranking_threshold:
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )
                        if len(reranking_results) >= top_n:
                            break
                    else:
                        # Since TEI responses are pre-sorted descending, 
                        # can safely break early if a score falls below threshold
                        break

            elif reranking_strategy == "adaptive":
                document_scores = [
                    resp["score"]
                    for resp in decoded_response
                ]

                # Required inputs:
                #
                # input.query_embedding
                # input.chunk_embeddings
                #
                # chunk_embeddings must be aligned with
                # input.retrieved_docs ordering.

                query_embedding = input.query_embedding

                chunk_embeddings = input.chunk_embeddings

                # Validate embeddings are available for adaptive strategy
                if not query_embedding or not chunk_embeddings:
                    logger.warning(
                        f"[ADAPTIVE] Missing required embeddings. "
                        f"query_embedding={'present' if query_embedding else 'missing'}, "
                        f"chunk_embeddings={'present' if chunk_embeddings else 'missing'}. "
                        f"Falling back to slice strategy."
                    )
                    # Execute slice fallback directly
                    top_n = reranker_top_n if reranker_top_n else 1
                    for best_response in decoded_response[:top_n]:
                        reranking_results.append(
                            {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                        )
                else:
                    selected_indices = adaptive_context_selection(
                        texts=[doc.text for doc in input.retrieved_docs],
                        chunk_embeddings=chunk_embeddings,
                        query_embedding=query_embedding,
                        reranker_scores=document_scores,
                    )

                    logger.info(
                        f"[ADAPTIVE] Selected chunk indices: {selected_indices}"
                    )

                    for idx in selected_indices:

                        best_response = decoded_response[idx]

                        reranking_results.append(
                            {
                                "text": input.retrieved_docs[
                                    best_response["index"]
                                ].text,
                                "score": best_response["score"],
                            }
                        )

            else:
                logger.warning(f"Unknown strategy {reranking_strategy}. Defaulting to slice.")
                for best_response in decoded_response[: input.top_n]:
                    reranking_results.append(
                        {"text": input.retrieved_docs[best_response["index"]].text, "score": best_response["score"]}
                    )

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