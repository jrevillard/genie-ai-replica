# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import time

from tracing import get_meter, get_tracer, sanitize_attributes, setup_trace_logging, setup_tracing

setup_tracing("genieai-retriever")

# Custom application metrics
_retriever_meter = get_meter()
_retrieval_requests = _retriever_meter.create_counter(
    "rag.retrieval.requests",
    description="Total retrieval requests",
)
_retrieval_duration = _retriever_meter.create_histogram(
    "rag.retrieval.duration",
    description="Retrieval duration",
    unit="s",
)

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
    GenieRetrievalResponse,
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
            chunk_embeddings = []
            query_embedding = []
            for r in response:
                if isinstance(r, str):
                    retrieved_docs.append(RetrievalResponseData(text=r, metadata=None))
                    chunk_embeddings.append([])
                else:
                    # Inject score into metadata so downstream consumers can read it
                    if r.get("score") is not None and r["doc"].metadata is not None:
                        r["doc"].metadata["score"] = r["score"]
                    # Pop the chunk embedding (set by the retriever for adaptive
                    # reranking) before building the response doc, so large vectors
                    # don't bloat retrieved_docs metadata sent to the reranker.
                    chunk_emb = (r["doc"].metadata or {}).pop("chunk_embedding", None)
                    chunk_embeddings.append(chunk_emb if isinstance(chunk_emb, list) else [])
                    # Echo the query embedding (stored on the first doc by the
                    # retriever) so the adaptive reranker can compute novelty.
                    if not query_embedding:
                        qe = (r["doc"].metadata or {}).pop("query_embedding", None)
                        if isinstance(qe, list) and qe:
                            query_embedding = qe
                    retrieved_docs.append(RetrievalResponseData(text=r["doc"].page_content, metadata=r["doc"].metadata))
            if isinstance(input, RetrievalRequest):
                result = GenieRetrievalResponse(retrieved_docs=retrieved_docs)
                # Carry chunk embeddings for the adaptive reranker (the base
                # RetrievalResponse has no embeddings field).
                if chunk_embeddings and all(ce for ce in chunk_embeddings):
                    result.chunk_embeddings = chunk_embeddings
            elif isinstance(input, ChatCompletionRequest):
                input.retrieved_docs = retrieved_docs
                input.documents = [doc.text for doc in retrieved_docs]
                # Propagate embeddings for adaptive reranking: the query embedding
                # (echoed by the retriever) + chunk embeddings when fully aligned.
                if query_embedding:
                    input.embedding = query_embedding
                if chunk_embeddings and all(ce for ce in chunk_embeddings):
                    input.chunk_embeddings = chunk_embeddings
                result = input

        # Record statistics
        statistics_dict["opea_service@retrievers"].append_latency(time.time() - start, None)

        # Record custom retrieval metrics
        _retrieval_latency = time.time() - start
        _retrieval_attrs = sanitize_attributes(
            {
                "rag.query_type": os.getenv("RETRIEVER_TYPE", "hybrid"),
                "error": "false",
            }
        )
        _retrieval_requests.add(1, _retrieval_attrs)
        _retrieval_duration.record(_retrieval_latency, _retrieval_attrs)

        if logflag:
            logger.debug(f"[ retrieval ] Output generated: {result}")

        return result

    except Exception as e:
        # Record error metric
        _err_latency = time.time() - start
        _err_attrs = sanitize_attributes(
            {
                "rag.query_type": os.getenv("RETRIEVER_TYPE", "hybrid"),
                "error": "true",
            }
        )
        _retrieval_requests.add(1, _err_attrs)
        _retrieval_duration.record(_err_latency, _err_attrs)
        logger.error(f"[ retrieval ] Error during retrieval invocation: {e}")
        raise


if __name__ == "__main__":
    logger.info("Retriever Microservice is starting...")
    service = opea_microservices["opea_service@retrievers"]

    # FastAPI auto-instrumentation is handled globally by tracing.py
    # setup_tracing() → FastAPIInstrumentor().instrument() runs before
    # OPEA comps creates the FastAPI app, so traceparent extraction works.

    service.start()
