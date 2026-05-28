# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os

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
from opentelemetry import propagate
from opentelemetry.trace import Status, StatusCode

from tracing import get_tracer

tracer = get_tracer(__name__)


# Defining a custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None


logger = CustomLogger("genie_tei_reranking")
logflag = os.getenv("LOGFLAG", False)

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice")  # slice, threshold, knee_threshold
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.75))
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 1))


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
