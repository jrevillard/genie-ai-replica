---
title: Troubleshooting
description: Common GENIE.AI operational problems, where to look first, and pointers to the deeper troubleshooting notes in the deployment guides.
weight: 4
---

This page lists the problems operators hit most often, the first place to look,
and where the deeper notes live. For install-time problems, see the
troubleshooting sections of the [deployment guides]({{< relref "/docs/deployment" >}}).

## General principle: trace, then logs, then code

For any "why did this answer come out wrong / slow / empty" question, the fastest
path is the **trace**, not the logs:

1. Find the query's trace in the [Trace explorer]({{< relref "/docs/observability/dashboards" >}}).
2. Walk the RAG stage spans to see which stage is slow or returns nothing.
3. Pivot to the [service logs]({{< relref "/docs/observability/dashboards" >}})
   for that stage's error detail.

See [Observability]({{< relref "/docs/observability" >}}) for how.

## Common problems

### Ingestion stuck or failed

- **Check** the ingestion log for the `file_id` — see where it stopped (parse?
  labelling? embedding?).
- **Dataprep traces**: look for `dataprep.llm.label_*` span errors → vLLM
  unavailable or rejecting guided JSON.
- **vLLM health**: is the generation/LM endpoint up? `docker service ls` and the
  service-health dashboard.
- **Raw-chunk fallback** in the log means labelling/embedding failed for that
  chunk but ingestion continued — investigate the per-chunk error.

### Retrieval returns nothing / wrong results

- **Empty retrieval**: is the knowledge base loaded? Are the document(s) in
  `completed` state? See [Document lifecycle]({{< relref "/docs/knowledge-base/document-lifecycle" >}}).
- **Wrong-topic retrieval**: check the label filter and the taxonomy —
  [Labelling & taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}}).
- **Embedding mismatch**: was the embedding model changed without re-ingestion?
  See [Updates]({{< relref "updates" >}}) — the re-ingestion rule.
- **Thresholds too strict**: retrieval `RETRIEVER_ARANGO_SCORE_THRESHOLD` / reranker `RERANKING_THRESHOLD`
  may be filtering everything.

### Gateway errors (502 / 504)

- A 502/504 means Kong could not reach an upstream service.
- `docker service ls` — is the target service running and healthy?
- **404 with a tiny (~47 byte) body** from a browser = the Nginx HTML fallback
  (route missing); **404 with a JSON body** = an application-level 404 (route
  exists, resource not found).
- Check Kong's own logs via the service-logs dashboard.

### Authentication / token errors

- Master token ≠ realm token — only use the master token for the Keycloak Admin
  API; application services validate against the realm. See
  [Keycloak admin guide]({{< relref "/docs/configuration/keycloak-admin-guide" >}}).
- "Account is not fully set up" on login → user profile missing required fields
  (`firstName`, `lastName`) or `emailVerified` not set, or credentials marked
  temporary.

### GPU out-of-memory

- A model service crashing with OOM → its `_GPU_UTIL` budget is too small, or the
  combined budgets exceed the GPU.
- Lower other services' budgets or move to a larger GPU profile. See
  [Scaling]({{< relref "scaling" >}}) and [GPU deployment]({{< relref "/docs/deployment/gpu" >}}).

### Observability shows no data

- **Collector down** alert firing → the OpenTelemetry Collector is not running.
  Restart it (`mode: global`, one per node).
- Telemetry present but incomplete → check `OTEL_TRACES_SAMPLER_RATE` (traces are
  sampled; metrics and logs are not).
- See [Observability &rarr; Configuration]({{< relref "/docs/observability/configuration" >}}).

## Where the deeper notes live

| Topic | Location |
|---|---|
| GPU / model runtime problems | [GPU deployment]({{< relref "/docs/deployment/gpu" >}}) troubleshooting |
| Compose startup problems | [Docker Compose setup]({{< relref "/docs/deployment/docker-compose-setup" >}}) troubleshooting |
| Swarm / node-label problems | [Docker Swarm setup]({{< relref "/docs/deployment/docker-swarm-setup" >}}) troubleshooting |
| Labelling quality problems | [Data labelling strategy]({{< relref "/docs/rag/data-labeling" >}}) |
| RAG internals (reranker, confidence) | [RAG pipeline]({{< relref "/docs/rag" >}}) |
