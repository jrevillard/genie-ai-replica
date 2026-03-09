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
        reranking_results = []

        if input.retrieved_docs:
            docs = [doc.text for doc in input.retrieved_docs]
            if isinstance(input, SearchedDoc):
                query = input.initial_query
            else:
                query = input.input

            # response = await self.client.post(
            #     json={"query": query, "texts": docs},
            #     model=f"{self.base_url}/rerank",
            #     task="text-reranking",
            # )
            
            # decoded_response = json.loads(response.decode())

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/rerank", 
                    json={"query": query, "texts": docs}
                ) as resp:
                    decoded_response = await resp.json()

            # Checking RERANKING_STRATEGY param value:
            logger.info(f"[ DEBUG ] Selected RERANKING STRATEGY is {RERANKING_STRATEGY}")

            if RERANKING_STRATEGY == "slice":
                top_n = RERANKER_TOP_N if RERANKER_TOP_N else 1                
                for best_response in decoded_response[:top_n]:
                    reranking_results.append({
                        "text": input.retrieved_docs[best_response["index"]].text, 
                        "score": best_response["score"]
                    })

            elif RERANKING_STRATEGY == "threshold":
                for best_response in decoded_response:
                    if best_response["score"] >= RERANKING_THRESHOLD:
                        reranking_results.append({
                            "text": input.retrieved_docs[best_response["index"]].text, 
                            "score": best_response["score"]
                        })

            elif RERANKING_STRATEGY == "knee_threshold":
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
                logger.warning(f"Unknown strategy {RERANKING_STRATEGY}. Defaulting to slice.")
                for best_response in decoded_response[: input.top_n]:
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
        
