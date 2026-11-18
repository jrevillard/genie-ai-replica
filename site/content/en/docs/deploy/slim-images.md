---
title: "Slim Image Variants"
description: "The slim image variants of the model-serving images — what they drop, when to pin them, and how they differ from the default images."
weight: 8
section: "deploy"
aliases:
  - /docs/deployment/slim-images/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-11-18
---

Three GENIE.AI images — the reranker, the retriever and the dataprep — are
published under **two tags** in the internal registry:

| tag | content | use it when |
|---|---|---|
| `:main` (and `:main-<sha>`, `:vX.Y.Z`) | the default image, with PyTorch's **CUDA** build | the node runs a model in-process on a GPU |
| `:main-slim` (and `:main-slim-<sha>`) | the same service code, with PyTorch's **CPU** build and the packages no service imports left out | every model call goes to an external GPU API |

Both tags carry the **same service code and the same versions of every
library** — only the installed dependency set differs. The slim variant is
not a different release: it is the same release, built without the weight a
CPU-only node never reads.

## Why the two variants exist

The default images resolve `torch==2.13.0` to the CUDA build, which carries
fifteen `nvidia-*` wheels plus Triton — about 3 GB compressed and 8 GB
unpacked. A node whose model calls all go to a remote vLLM/TEI API stores
that weight and never loads it, and on a node with a tight image disk it is
what turns a repoint into an eviction and then a `DiskPressure` admission
lockout.

Measured on one host, same base image:

| image | `:main` | `:main-slim` |
|---|---|---|
| `genie-ai-reranker` | 6.82 GB | 848 MB |
| `genie-ai-retriever-arango` | 8.54 GB | 1.75 GB |
| `genie-ai-dataprep-arango` | 10.0 GB | 3.95 GB |

## What the slim variant drops, per image

- **reranker** — no PyTorch at all. The reranker is a client: it calls the
  rerank endpoint and nothing else, so it has no local model to run.
- **retriever** — PyTorch at its CPU build. The retriever keeps a local
  fallback (a sentence-transformers model loaded in-process) for a
  deployment with no embedding endpoint; it runs on CPU.
- **dataprep** — PyTorch at its CPU build, and no JVM (the JVM belongs to
  pyspark, which only the default lock carries). The dataprep's local OCR
  (docling + easyocr) keeps working, on CPU.

## When to pin the slim tag

- **Pin `:main-slim`** on a node that has **no GPU** and calls an external
  GPU API — the external-GPU topology. Every model call leaves the node, so
  the CUDA stack is dead weight there.
- **Keep `:main`** on a node that runs a model in-process on a GPU, and in
  air-gapped deployments where the local model path is the only path.

## How to pin it

The tag is a normal image tag: set it where the deployment names the image.

```yaml
# genie-ai-deploy overlay (Helm chart values)
services:
  reranker:
    image:
      repository: genie-ai-reranker
      tag: main-slim
  retrieverArango:
    image:
      repository: genie-ai-retriever-arango
      tag: main-slim
  dataprepArango:
    image:
      repository: genie-ai-dataprep-arango
      tag: main-slim
```

With Docker Compose, the tag is the image-tag variable of the service:

```bash
GENIE_AI_RERANKER_IMAGE_TAG=main-slim
GENIE_AI_RETRIEVER_ARANGO_IMAGE_TAG=main-slim
GENIE_AI_DATAPREP_ARANGO_IMAGE_TAG=main-slim
```

Pinning a **digest** works the same way and is what the Kubernetes overlays
do — the digest is of the slim image's manifest, not the default one.

## Air-gapped deployments

The slim variants are extra **tags**, not extra images: an operator who
mirrors the GENIE.AI images by tag should mirror the `:main-slim` tags too
if the target nodes have no GPU. The number of distinct image repositories
does not change.

## See also

- [GPU Deployment](/docs/deploy/gpu/) — the GPU profiles and VRAM sizing.
- [Deployment Topologies](/docs/deploy/topologies/) — which topology a
  deployment runs, and where the model calls go.
- [Kubernetes Deployment](/docs/deploy/kubernetes/) — the chart, the overlays
  and the Flux reconcile.
