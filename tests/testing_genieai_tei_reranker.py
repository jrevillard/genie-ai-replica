# REFACTORED FOR TESTING

# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import json
import os
import aiohttp
from typing import Union
from kneed import KneeLocator

from huggingface_hub import AsyncInferenceClient

from comps import CustomLogger, LLMParamsDoc, OpeaComponentRegistry, SearchedDoc, ServiceType
from comps.cores.proto.api_protocol import (
    ChatCompletionRequest,
    RerankingRequest,
    RerankingResponse,
    RerankingResponseData,
)

# Importing the base class from original OPEA
from integrations.tei import OpeaTEIReranking 

logger = CustomLogger("genie_tei_reranking")
logflag = os.getenv("LOGFLAG", False)

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice") # slice, threshold, knee_threshold
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 1))

@OpeaComponentRegistry.register("GENIE_TEI_RERANKING")
class GenieTEIReranking(OpeaTEIReranking):
    """
    GENIE.AI Extension of OpeaTEIReranking
    Adds: Multi-strategy reranking (slice, threshold, knee_threshold)
    """

    async def invoke(
        self, input: Union[SearchedDoc, RerankingRequest, ChatCompletionRequest]
    ) -> Union[LLMParamsDoc, RerankingResponse, ChatCompletionRequest]:
        """Invokes the reranking service to generate rerankings for the provided input."""
        
        # Testing optimisation
        # Extract parameters dynamically from request payload to support automated testing sweeps via ChatQnA
        input_dict = input.model_dump(exclude_none=True) if hasattr(input, "model_dump") else getattr(input, "dict", lambda: {})()
        
        current_strategy = input_dict.get("reranking_strategy", RERANKING_STRATEGY)
        current_threshold = input_dict.get("reranking_threshold", RERANKING_THRESHOLD)
        current_top_n = input_dict.get("reranker_top_n", RERANKER_TOP_N)

        logger.info(f"[ DEBUG - VERBOSE ] Extracted dynamic reranker params from payload:")
        logger.info(f"[ DEBUG - VERBOSE ]   -> Strategy: {current_strategy} (Fallback env: {RERANKING_STRATEGY})")
        logger.info(f"[ DEBUG - VERBOSE ]   -> Threshold: {current_threshold} (Fallback env: {RERANKING_THRESHOLD})")
        logger.info(f"[ DEBUG - VERBOSE ]   -> Top N: {current_top_n} (Fallback env: {RERANKER_TOP_N})")

        reranking_results = []

        if input.retrieved_docs:
            docs = [doc.text for doc in input.retrieved_docs]
            if isinstance(input, SearchedDoc):
                query = input.initial_query
            else:
                query = input.input

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/rerank", 
                    json={"query": query, "texts": docs}
                ) as resp:
                    decoded_response = await resp.json()

            # Checking RERANKING_STRATEGY param value using the dynamic variable
            logger.info(f"[ DEBUG - VERBOSE ] Executing RERANKING STRATEGY branch: {current_strategy}")

            if current_strategy == "slice":
                top_n = current_top_n if current_top_n else 1                
                for best_response in decoded_response[:top_n]:
                    reranking_results.append({
                        "text": input.retrieved_docs[best_response["index"]].text, 
                        "score": best_response["score"]
                    })

            elif current_strategy == "threshold":
                for best_response in decoded_response:
                    if best_response["score"] >= current_threshold:
                        reranking_results.append({
                            "text": input.retrieved_docs[best_response["index"]].text, 
                            "score": best_response["score"]
                        })

            elif current_strategy == "knee_threshold":
                scores = [resp["score"] for resp in decoded_response]
                indices = list(range(len(scores)))

                kneedle = KneeLocator(
                    indices,
                    scores,
                    curve="convex",
                    direction="decreasing"
                )

                # If a knee is found, slice up to the knee + 1. Otherwise, keep all.
                cutoff = kneedle.knee + 1 if kneedle.knee is not None else len(scores)

                for i in range(cutoff):
                    best_response = decoded_response[i]
                    reranking_results.append({
                        "text": input.retrieved_docs[best_response["index"]].text, 
                        "score": best_response["score"]
                    })
            else:
                logger.warning(f"Unknown strategy {current_strategy}. Defaulting to slice.")
                top_n = current_top_n if current_top_n else 1
                for best_response in decoded_response[: top_n]:
                    reranking_results.append({
                        "text": input.retrieved_docs[best_response["index"]].text, 
                        "score": best_response["score"]
                    })

        # Checking reranker output composition
        logger.info(f"[ DEBUG ] Total number of documents in reranker output: {len(reranking_results)}")

        reranking_docs = [
            RerankingResponseData(text=doc["text"], score=doc["score"]) 
            for doc in reranking_results
        ]
        
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