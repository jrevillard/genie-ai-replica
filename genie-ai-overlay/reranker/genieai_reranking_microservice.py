# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os
import time

from opentelemetry.trace import Status, StatusCode

from tracing import get_meter, get_tracer, sanitize_attributes, setup_trace_logging, setup_tracing

setup_tracing("genieai-reranker")

# Custom application metrics
_reranker_meter = get_meter()
_rerank_requests = _reranker_meter.create_counter(
    "rag.rerank.requests",
    description="Total reranking requests",
)
_rerank_duration = _reranker_meter.create_histogram(
    "rag.rerank.duration",
    description="Reranking duration",
    unit="s",
)

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
from pydantic import Field

logger = CustomLogger("opea_reranking_microservice")
setup_trace_logging("opea_reranking_microservice")
logflag = os.getenv("LOGFLAG", False)


# Custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None
    embedding: list[float] = Field(default_factory=list)
    chunk_embeddings: list[list[float]] = Field(default_factory=list)


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

    reranking_strategy = os.getenv("RERANKING_STRATEGY", "adaptive")
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

            # Record custom reranking metrics
            _rerank_latency = time.time() - start
            _model_id = os.getenv("RERANKER_MODEL_ID", "unknown")
            _rerank_attrs = sanitize_attributes({"reranker.model_id": _model_id, "error": "false"})
            _rerank_requests.add(1, _rerank_attrs)
            _rerank_duration.record(_rerank_latency, _rerank_attrs)
            return reranking_response

        except Exception as e:
            # Record error metric
            _err_latency = time.time() - start
            _model_id = os.getenv("RERANKER_MODEL_ID", "unknown")
            _err_attrs = sanitize_attributes({"reranker.model_id": _model_id, "error": "true"})
            _rerank_requests.add(1, _err_attrs)
            _rerank_duration.record(_err_latency, _err_attrs)
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            logger.error(f"Error during reranking invocation: {e}")
            raise


if __name__ == "__main__":
    opea_microservices["opea_service@reranking"].start()
    # FastAPI auto-instrumentation is handled globally by tracing.py
    # setup_tracing() → FastAPIInstrumentor().instrument() runs before
    # OPEA comps creates the FastAPI app, so traceparent extraction works.
    logger.info("OPEA Reranking Microservice is starting...")
