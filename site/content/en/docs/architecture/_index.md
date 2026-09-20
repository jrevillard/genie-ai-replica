---
title: "Architecture"
description: "System-wide architecture: C4 container view, authentication flows, the service-to-service auth matrix, and the OPEA microservices contract surface."
weight: 50
section: "architecture"
---

## Documents in this section

1. [Architecture Overview](/docs/architecture/architecture/) — C4 context/container
   view, RAG pipeline flow, gateway/auth flows, observability, and API structure.
2. [OPEA Microservices](/docs/architecture/opea-microservices/) — Architecture of the
   `genie-ai-overlay/` layer: chatqna, retriever, reranker, dataprep, embedding,
   textgen — and the inter-service contract surface.
3. [Trust Boundaries & Security Architecture](/docs/architecture/trust-boundaries/) —
   Authentication, JWT validation, JWKS caching, gateway header chain, and the
   security threat model.

## Related

- For metrics, logs, traces, dashboards, and alerting, see the dedicated
  [Observability]({{< relref "/docs/observe" >}}) section.
- For the RAG pipeline, see [RAG Pipeline]({{< relref "/docs/rag-pipeline" >}}).
- For HTTP request/response shapes, see
  [API Contracts — Backend]({{< relref "/docs/backend/api-contracts-backend" >}}).
