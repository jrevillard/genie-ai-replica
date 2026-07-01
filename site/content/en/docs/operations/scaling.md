---
title: Scaling
description: Scaling GENIE.AI services horizontally and tuning GPU resource allocation per service.
weight: 3
---

GENIE.AI runs on Docker Swarm, so horizontal scaling is a `docker service scale`
command. Vertical scaling — especially GPU memory — is a configuration change per
service. The two are independent and solve different problems.

## Horizontal scaling (replicas)

Scale a stateless service to more replicas:

```bash
docker service scale genieai_<service>=<replicas>
```

Services that scale well (stateless, query-time):

| Service | Scales? | Notes |
|---|---|---|
| Backend (BFF) | Yes | Stateless behind Kong. |
| ChatQnA | Yes | Stateless orchestrator. |
| Retriever | Yes | Stateless; shares the same ArangoDB. |
| Reranker / TEI | Yes | Stateless. |
| vLLM | With care | Each replica needs its own GPU memory budget; see below. |
| Dataprep | Yes (ingest) | More replicas = more parallel ingestion throughput. |
| ArangoDB | **No (single-node)** | The bundled ArangoDB is single-node; do not scale it. Add resources, not replicas. |

> **ArangoDB is the bottleneck you cannot replica your way out of.** The
> single-node database handles the whole retrieval load. If retrieval latency
> climbs under load, first check the database's resources and query performance
> (see the *VictoriaMetrics* dashboard), not the retriever count.

## Vertical scaling (GPU memory)

GPU memory is allocated per service via `VLLM_GPU_UTIL` (and friends) and the
profile files `env.t4` / `env.rtx6000`. Multiple model services share one GPU;
their `_GPU_UTIL` budgets must sum to ≤ 1.0.

```
# Example: T4 (16 GB) split between LLM and translation
VLLM_GPU_UTIL=0.6          # LLM gets ~60% of GPU memory
VLLM_TRANSLATION_GPU_UTIL=0.4
```

To give a service more memory, raise its utilisation and lower another's. See
[GPU deployment]({{< relref "/docs/deployment/gpu" >}}) and
[Choosing models]({{< relref "/docs/rag/choosing-models" >}}) for the per-profile
memory budgets.

> **Remote GPU.** If the GPU lives on a different host than the orchestrators,
> set `GPU_NODE_HOST` and skip the `gpu-models` profile — the model service
> endpoints point at the remote GPU node. See the `env` file, Section 14.

## When to scale what

| Symptom | First action |
|---|---|
| High request latency across all services | Check the [Observability]({{< relref "/docs/observability" >}}) trace waterfall to find the slow stage, then scale *that* stage. |
| Retrieval latency climbing under load | Inspect ArangoDB resources/queries before adding retrievers. |
| Generation latency (LLM queueing) | Scale vLLM replicas (each needs GPU memory) or raise `VLLM_GPU_UTIL`. |
| Ingestion throughput too slow | Scale dataprep replicas; check labelling concurrency. |
| GPU out-of-memory | Lower `_GPU_UTIL` budgets or move to a larger GPU profile. |

> **Measure before scaling.** The observability stack exists precisely so you
> scale the right service. Scaling blindly multiplies cost without fixing the
> bottleneck.
