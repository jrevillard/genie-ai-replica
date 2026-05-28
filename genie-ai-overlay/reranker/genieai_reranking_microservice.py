# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os
import time

from opentelemetry.trace import Status, StatusCode

from tracing import get_tracer, setup_tracing

setup_tracing("genieai-reranker")

tracer = get_tracer(__name__)

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
from comps.rerankings.src.integrations.genieai_tei_reranker import GenieTEIReranking  # noqa: F401

logger = CustomLogger("opea_reranking_microservice")
logflag = os.getenv("LOGFLAG", False)


# Custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None


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
    input: SearchedMultimodalDoc | GenieSearchedDoc | RerankingRequest | ChatCompletionRequest,
) -> RerankedDoc | LLMParamsDoc | RerankingResponse | ChatCompletionRequest | LVMVideoDoc:
    start = time.time()

    # Log the input if logging is enabled
    if logflag:
        logger.info(f"Input received: {input}")

    reranking_strategy = os.getenv("RERANKING_STRATEGY", "slice")
    input_doc_count = len(input.retrieved_docs) if hasattr(input, "retrieved_docs") and input.retrieved_docs else 0

    with tracer.start_as_current_span("reranker.rerank") as span:
        span.set_attribute("reranker.strategy", reranking_strategy)
        span.set_attribute("reranker.input_doc_count", input_doc_count)

        try:
            # Use the loader to invoke the component
            reranking_response = await loader.invoke(input)

            output_doc_count = 0
            if hasattr(reranking_response, "reranked_docs") and reranking_response.reranked_docs:
                output_doc_count = len(reranking_response.reranked_docs)
            span.set_attribute("reranker.output_doc_count", output_doc_count)

            # Log the result if logging is enabled
            if logflag:
                logger.info(f"Output received: {reranking_response}")

            # Record statistics
            statistics_dict["opea_service@reranking"].append_latency(time.time() - start, None)
            return reranking_response

        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            logger.error(f"Error during reranking invocation: {e}")
            raise


if __name__ == "__main__":
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    opea_microservices["opea_service@reranking"].start()
    app = opea_microservices["opea_service@reranking"]
    FastAPIInstrumentor.instrument_app(app._app if hasattr(app, "_app") else app)
    logger.info("OPEA Reranking Microservice is starting...")
