# Hybrid Vector-Graph Retriever Micro-service

## Introduction
The **GENIE.AI retriver micro-service** is an extension of the original OPEA retriever microservice and provides a robust retrieval engine designed for Retrieval-Augmented Generation (RAG) pipelines. It utilizes a hybrid approach that integrates **vector similarity search**, **graph traversal**, and **metadata-based label filtering** to provide highly contextualized results. By combining these techniques, the service moves beyond simple keyword or distance-based lookups to explore the semantic and relational connections within a dataset.

The current implementation leverages ArangoDB as its core database engine due to its multimodal capabilities—efficiently handling both document-store (for vector data) and graph-store operations—and the accessibility of its open-source community edition.

The custom GENIE.AI retriever logic builds on code initially developed by the ArangoDB and Intel teams as part of the OPEA framework. It introduces several extensions and optimizes and externalizes multiple parameters, enabling more granular configuration of the retriever microservice directly through environment variables. 

## High-Level Logic
The retrieval process follows a multi-stage pipeline:
1. **Initial Search**: The service receives a query, generates an embedding, and performs a similarity search (using algorithms like MMR or Standard Similarity).
2. **Filtered Selection**: Results are refined based on metadata labels (e.g., service or category labels) to ensure domain-specific accuracy.
3. **Relational Expansion**: If enabled, the engine treats initial matches as "seed" points and performs a graph traversal to collect "Related Information" from connected nodes or edges.
4. **Contextual Refinement**: An optional summarization step uses an LLM to condense the aggregated findings into a concise, query-relevant context for the final generation phase.

---

## Configuration Parameters

The behavior and performance of the micro-service are governed by the following parameters:

### Search & Entry Point
| Parameter | Description | Anticipated Impact |
| :--- | :--- | :--- |
| `ARANGO_SEARCH_MODE` | Specifies the vector search strategy, such as standard similarity or Maximum Marginal Relevance (MMR). | Determines whether the engine prioritizes the closest possible matches or a diverse range of relevant results. |
| `ARANGO_SEARCH_START` | Defines the starting collection level: `node`, `edge`, or `chunk`. | Changes the granularity of the search; starting at a 'node' focuses on entities, while 'chunk' focuses on raw text segments. |

### Graph Traversal Logic
| Parameter | Description | Anticipated Impact |
| :--- | :--- | :--- |
| `ARANGO_TRAVERSAL_ENABLED` | A boolean flag to activate graph-based expansion of search results. | When enabled, the retriever fetches additional context from related documents linked in the graph. |
| `ARANGO_TRAVERSAL_MAX_DEPTH` | The maximum number of hops allowed from the initial search result. | Higher values provide deeper context but increase computational cost and risk including irrelevant data. |
| `ARANGO_TRAVERSAL_MAX_RETURNED` | Limits the number of related items returned from the traversal. | Prevents overwhelming the context window and keeps responses focused. |
| `ARANGO_TRAVERSAL_SCORE_THRESHOLD` | The minimum similarity score required for related items to be included. | Ensures that "Related Information" added via graph traversal remains semantically relevant to the query. |
| `ARANGO_TRAVERSAL_CONCURRENT_BATCHES` | Configures the number of threads (up to 4) used for parallel graph queries. | Directly impacts latency; higher concurrency speeds up retrieval for multiple search results. |

### Post-Processing
| Parameter | Description | Anticipated Impact |
| :--- | :--- | :--- |
| `SUMMARIZER_ENABLED` | Enables an LLM-driven summarization of the retrieved content. | Condenses long documents and graph neighborhoods into a focused summary, improving final generation quality. |

---

## Technical Dependencies
* **Database**: ArangoDB (supports Document, Graph, and Vector search).
* **Framework**: OPEA Component architecture with FastAPI.
* **LLM Integration**: Supports OpenAI and vLLM for embeddings and summarization tasks.