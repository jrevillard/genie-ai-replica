# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os
import time
from typing import Union, Optional
from pydantic import Field

from integrations.ovms import OpeaOVMSReranking
from integrations.tei import OpeaTEIReranking
from integrations.videoqna import OpeaVideoReranking
import integrations.genieai_tei_reranker

from comps import (
    CustomLogger,
    OpeaComponentLoader,
    ServiceType,
    opea_microservices,
    register_microservice,
    register_statistics,
    statistics_dict,
)
from comps.cores.proto.api_protocol import ChatCompletionRequest, RerankingRequest, RerankingResponse
from comps.cores.proto.opea_docarray import LLMParamsDoc, LVMVideoDoc, RerankedDoc, SearchedDoc, SearchedMultimodalDoc
from comps.cores.telemetry.opea_telemetry import opea_telemetry

logger = CustomLogger("opea_reranking_microservice")
logflag = os.getenv("LOGFLAG", False)

# Custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: Optional[str] = None
    reranking_threshold: Optional[float] = None
    top_n: Optional[int] = None

rerank_component_name = os.getenv("RERANK_COMPONENT_NAME", "GENIE_TEI_RERANKING")
# Initialize OpeaComponentLoader
loader = OpeaComponentLoader(rerank_component_name, description=f"OPEA RERANK Component: {rerank_component_name}")


@register_microservice(
    name="opea_service@reranking",
    service_type=ServiceType.RERANK,
    endpoint="/v1/reranking",
    host="0.0.0.0",
    port=8000,
)
@opea_telemetry
@register_statistics(names=["opea_service@reranking"])
async def reranking(
    input: Union[SearchedMultimodalDoc, GenieSearchedDoc, RerankingRequest, ChatCompletionRequest],
) -> Union[RerankedDoc, LLMParamsDoc, RerankingResponse, ChatCompletionRequest, LVMVideoDoc]:
    start = time.time()

    # Log the input if logging is enabled
    if logflag:
        logger.info(f"Input received: {input}")

    try:
        # Use the loader to invoke the component
        reranking_response = await loader.invoke(input)

        # Log the result if logging is enabled
        if logflag:
            logger.info(f"Output received: {reranking_response}")

        # Record statistics
        statistics_dict["opea_service@reranking"].append_latency(time.time() - start, None)
        return reranking_response

    except Exception as e:
        logger.error(f"Error during reranking invocation: {e}")
        raise


if __name__ == "__main__":
    opea_microservices["opea_service@reranking"].start()
    logger.info("OPEA Reranking Microservice is starting...")