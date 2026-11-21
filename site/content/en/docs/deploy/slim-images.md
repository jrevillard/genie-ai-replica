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
| `:main` (and `:main-<sha>`, `:vX.Y.Z`, `:latest`) | the default image, with PyTorch's **CUDA** build | the node runs a model in-process on a GPU |
| `:main-slim` (and `:main-slim-<sha>`) | the same service code, with PyTorch's **CPU** build and the packages no service imports left out | every model call goes to an external GPU API |
| `:latest-slim` (and `:vX.Y.Z-slim`) | the slim build of the latest **release** — the same variant, of the released images rather than of the branch | every model call goes to an external GPU API, and the deployment follows the release rather than the branch |

Both tags carry the **same service code and the same versions of every
library** — only the installed dependency set differs. The slim variant is
not a different release: it is the same release, built without the weight a
CPU-only node never reads.

The version and the variant are two independent knobs, one per deployment
target:

| | Kubernetes | Compose / Swarm |
|---|---|---|
| the version (all images) | `imageTag` | `GENIE_AI_IMAGE_TAG` |
| the variant (the three model-serving images) | `opea.imageTagSuffix` | `GENIE_AI_OPEA_IMAGE_TAG_SUFFIX` |

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
| `genie-ai-retriever-arango` | 8.54 GB | 690 MB |
| `genie-ai-dataprep-arango` | 10.0 GB | 2.25 GB |

## What the slim variant drops, per image

The slim variants carry **no model stack at all** — no PyTorch, no CUDA
wheels, no local weights:

- **reranker** — nothing. The reranker is a client: it calls the rerank
  endpoint and holds nothing.
- **retriever** — no in-process embedding fallback. The retriever loads a
  sentence-transformers model locally only when **no** embedding endpoint is
  configured; the slim image therefore needs a remote embedding endpoint,
  which the external-GPU mode always has.
- **dataprep** — no local document converter, no OCR, no EasyOCR models, no
  JVM (the JVM belongs to pyspark, which only the default lock carries).
  The conversion is delegated to a remote docling-serve.

## What the slim dataprep needs from the operator

The slim dataprep delegates the document conversion, so it needs a
docling-serve endpoint:

```yaml
# genie-ai-deploy overlay — the chart renders DOCLING_ENDPOINT from it
opea:
  gpu:
    mode: external
    paths:
      docling: /docling
```

Without it the slim dataprep has no local converter and refuses to start —
the log names the remedy. It also supports the default `fast`
table-extraction strategy only: the `hq` strategy needs the layout models
the slim image does not carry. Use the default image for a deployment that
needs `hq` tables or a local OCR pipeline.

## When to pin the slim tag

- **Pin `:main-slim`** on a node that has **no GPU** and calls an external
  GPU API — the external-GPU topology. Every model call leaves the node, so
  the CUDA stack is dead weight there.
- **Keep `:main`** on a node that runs a model in-process on a GPU, and in
  air-gapped deployments where the local model path is the only path.

## How to pin it

The tag is a normal image tag: set it where the deployment names the image.

**Kubernetes** — one line in the overlay:

```yaml
# genie-ai-deploy overlay (Helm chart values)
opea:
  imageTagSuffix: "-slim"
```

**Docker Compose** — one line in the `.env`, wherever you put it:

```bash
GENIE_AI_OPEA_IMAGE_TAG_SUFFIX=-slim
```

**Docker Swarm (Ansible)** — one `--extra-vars` value, NOT a line in the
node's `.env`: the playbook regenerates that file on every run, so a line
written by hand is overwritten at the next deploy (and the fat images come
back, silently).

```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@prompt \
  --extra-vars '{"repo_branch":"main","genie_ai_image_tag":"main","genie_ai_opea_image_tag_suffix":"-slim"}'
```

It applies to the three model-serving images and to nothing else. A
per-image pin (`opea.reranker.image.tag` in Kubernetes,
`GENIE_AI_RERANKER_IMAGE_TAG` in Compose) names the EXACT tag and never
gets the suffix — in Compose, that pin is a line **you** add to your `.env`
(the template declares no per-service tag for the three, because such a
line would shadow the version and the variant).

The knob COMPOSES `<version><suffix>` — the version it is applied to must be
a tag the CI publishes a slim build of: the branch tag (`main`) or a release
tag (`v2.1.0`). It does not compose the immutable sha-pinned form
(`:main-slim-<sha>`), because the CI publishes that one with the suffix
BEFORE the sha — so pin it by name (`GENIE_AI_RERANKER_IMAGE_TAG=main-slim-<sha>`),
which the per-image pin does verbatim.

Pinning a **digest** works the same way — the digest is of the slim
image's manifest, not the default one.

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
