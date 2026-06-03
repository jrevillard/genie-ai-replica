# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import time

import genie_ssl_patch  # noqa: F401 — SSL bypass + API key injection (remote GPU support)

from tracing import get_tracer, setup_trace_logging, setup_tracing

setup_tracing("genieai-retriever")

# import for retrievers component registration
# from integrations.elasticsearch import OpeaElasticsearchRetriever
# from integrations.mariadb import OpeaMARIADBVectorRetriever
# from integrations.milvus import OpeaMilvusRetriever
# from integrations.neo4j import OpeaNeo4jRetriever
# from integrations.opensearch import OpeaOpensearchRetriever
# from integrations.pathway import OpeaPathwayRetriever
# from integrations.pgvector import OpeaPGVectorRetriever
# from integrations.pinecone import OpeaPineconeRetriever
# from integrations.qdrant import OpeaQDrantRetriever
# from integrations.redis import OpeaRedisRetriever
# from integrations.vdms import OpeaVDMsRetriever

RETRIEVER_SERVICE_HOST_IP = os.getenv("RETRIEVER_SERVICE_HOST_IP", "0.0.0.0")
RETRIEVER_SERVICE_PORT = int(os.getenv("RETRIEVER_SERVICE_PORT", 7000))

from comps import (
    CustomLogger,
    EmbedDoc,
    EmbedMultimodalDoc,
    OpeaComponentLoader,
    SearchedDoc,
    SearchedMultimodalDoc,
    ServiceType,
    TextDoc,
    opea_microservices,
    register_microservice,
    register_statistics,
    statistics_dict,
)
from comps.cores.proto.genieai_api_protocol import (
    ChatCompletionRequest,
    RetrievalRequest,
    RetrievalRequestArangoDB,
    RetrievalResponse,
    RetrievalResponseData,
)
from comps.retrievers.src.integrations.genieai_retriever_arangodb import GenieaiArangoRetriever  # noqa: F401

logger = CustomLogger("genieai_retriever_microservice")
setup_trace_logging("genieai_retriever_microservice")
logflag = os.getenv("LOGFLAG", False)


# Custom data subclass
class GenieEmbedDoc(EmbedDoc):
    search_start: str | None = None
    enable_traversal: str | None = None
    traversal_max_depth: int | None = None
    traversal_max_returned: int | None = None
    traversal_score_threshold: float | None = None


retriever_component_name = os.getenv("RETRIEVER_COMPONENT_NAME", "GENIE_RETRIEVER_ARANGODB")

# Initialize OpeaComponentLoader
loader = OpeaComponentLoader(
    retriever_component_name,
    description=f"OPEA RETRIEVER Component: {retriever_component_name}",
)


@register_microservice(
    name="opea_service@retrievers",
    service_type=ServiceType.RETRIEVER,
    endpoint="/v1/retrieval",
    host=RETRIEVER_SERVICE_HOST_IP,
    port=RETRIEVER_SERVICE_PORT,
)
@register_statistics(names=["opea_service@retrievers"])
async def retrieve_docs(
    input: GenieEmbedDoc | EmbedMultimodalDoc | RetrievalRequest | RetrievalRequestArangoDB | ChatCompletionRequest,
) -> SearchedDoc | SearchedMultimodalDoc | RetrievalResponse | ChatCompletionRequest:
    start = time.time()

    if logflag:
        logger.info(f"[ retrieval ] input: {input}")

    try:
        tracer = get_tracer("retriever.retrieve")
        with tracer.start_as_current_span("retriever.hybrid_search") as span:
            response = await loader.invoke(input)

            # Set RAG attributes (metadata only — no PII)
            if isinstance(response, list):
                span.set_attribute("rag.chunk_count", len(response))

            if logflag:
                logger.debug(f"[ retrieval ] Retriever component response: {response}")

        retrieved_docs = []
        if isinstance(input, (EmbedDoc, EmbedMultimodalDoc)):
            metadata_list = []
            for r in response:
                # If the input had an image, pass that through in the metadata along with the search result image
                if isinstance(input, EmbedMultimodalDoc) and input.base64_image:
                    if r["doc"].metadata["b64_img_str"]:
                        r["doc"].metadata["b64_img_str"] = [input.base64_image, r["doc"].metadata["b64_img_str"]]
                    else:
                        r["doc"].metadata["b64_img_str"] = input.base64_image
                if r["doc"].metadata:
                    metadata_list.append(r["doc"].metadata)
                retrieved_docs.append(TextDoc(text=r["doc"].page_content))
            result = SearchedMultimodalDoc(
                retrieved_docs=retrieved_docs, initial_query=input.text, metadata=metadata_list
            )
        else:
            for r in response:
                if isinstance(r, str):
                    retrieved_docs.append(RetrievalResponseData(text=r, metadata=None))
                else:
                    retrieved_docs.append(RetrievalResponseData(text=r["doc"].page_content, metadata=r["doc"].metadata))
            if isinstance(input, RetrievalRequest):
                result = RetrievalResponse(retrieved_docs=retrieved_docs)
            elif isinstance(input, ChatCompletionRequest):
                input.retrieved_docs = retrieved_docs
                input.documents = [doc.text for doc in retrieved_docs]
                result = input

        # Record statistics
        statistics_dict["opea_service@retrievers"].append_latency(time.time() - start, None)

        if logflag:
            logger.debug(f"[ retrieval ] Output generated: {result}")

        return result

    except Exception as e:
        logger.error(f"[ retrieval ] Error during retrieval invocation: {e}")
        raise


if __name__ == "__main__":
    logger.info("Retriever Microservice is starting...")
    service = opea_microservices["opea_service@retrievers"]

    # TODO(7.5): FastAPIInstrumentor.instrument_app() fails with
    # "Cannot add middleware after an application has started" because
    # the OPEA comps framework initializes routes during service creation.
    # Requires instrumenting INSIDE the comps init flow, not after.
    # from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    # FastAPIInstrumentor.instrument_app(service._app)

    service.start()
