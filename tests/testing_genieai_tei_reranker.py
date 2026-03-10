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

# 1. Renamed to defaults so they act as a fallback if the API payload doesn't contain them
DEFAULT_RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice") 
DEFAULT_RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
DEFAULT_RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 1))

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
        
        # ---> NEW: Extract dynamic parameters from the payload sent by ChatQnA
        rag_params = getattr(input, 'rag_params', {})
        
        # Override environment variables with request-level parameters
        current_strategy = str(rag_params.get("RERANKING_STRATEGY", DEFAULT_RERANKING_STRATEGY))
        current_threshold = float(rag_params.get("RERANKING_THRESHOLD", DEFAULT_RERANKING_THRESHOLD))
        current_top_n = int(rag_params.get("RERANKER_TOP_N", DEFAULT_RERANKER_TOP_N))

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

            logger.info(f"[ DEBUG ] Selected RERANKING STRATEGY is {current_strategy}")

            # ---> NEW: Apply dynamic variables to logic mapping
            if current_strategy == "slice":              
                for best_response in decoded_response[:current_top_n]:
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
                for best_response in decoded_response[:current_top_n]:
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