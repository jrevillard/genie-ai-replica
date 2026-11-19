# Helm/Kubernetes ROCm Handoff — Strix Halo (gfx1151)

Handoff note for the helm/Kubernetes deployment path. Originally written
2026-11-11 for charts living in the external `genie-ai-deploy` repository;
**main has since absorbed the Helm chart in-repo** (`charts/genieai-umbrella/`,
merge !520, 2026-11-17) — the chart and its k8s scripts are HERE now, the
per-environment overlays (Flux, values, SealedSecrets) stay in
`genie-ai-deploy`. This note still carries everything measured on this
repo's reference machine so a ROCm `values-*.yaml` can be authored without
re-running the spike. Audience: the engineer who maintains those charts —
they have NOT seen this repo's spike.

**This work is tracked: issue #2015** ("Kubernetes: the ROCm chart
profile — four vLLM workloads, the AMD device plugin, and the two GPU
backend switches"). Everything this note records is the input to that
issue; the `values-rocm.yaml` step below is work the chart profile must
produce, not a file that exists today (it is in neither this repo nor
`genie-ai-deploy`). Filed from the review of !968 — a doc is not a work
item, so the deferred chart work needed an owner and a status.

## What landed in this repo

The ROCm GPU tier here is config + image pins only (no service-source
changes, no NVIDIA-path edits):

- `docker-compose.rocm.yaml` — overlay on the main compose stack
  (single-server)
- `docker-compose.rocm.gpu.yaml` — overlay on the standalone GPU-node
  stack (split topology)
- `env.strixhalo` — sizing file (values below)
- `deploy/ansible/deploy-gpu-rocm.yml` +
  `deploy/ansible/group_vars/rocm_gpu_nodes/vars.yml` — GPU-node automation
- Measurements behind every number:
  `docs/superpowers/specs/2026-11-11-rocm-gpu-tier-spike-results.md`
  (companion design: `2026-11-11-rocm-gpu-tier-design.md`)

## Hardware (verified 2026-11-11 on the reference machine)

AMD Ryzen AI MAX+ 395 "Strix Halo", Radeon 8060S iGPU, `gfx1151`, 91 GB
unified LPDDR5X. There is no discrete VRAM: vLLM claims fractions of the
**GTT aperture** — measured **45.8 GiB** (`rocm-smi --showmeminfo gtt`) —
which is carved from system RAM, so GPU-tier claims add to the host's RAM
pressure. Kernel side: in-tree `amdgpu`, `/dev/kfd` +
`/dev/dri/renderD128` present. **No host ROCm userland is needed** — the
containers carry it.

## Image pins (spike winners)

| Role | Image |
|---|---|
| vLLM LLM + vLLM translation | `rocm/vllm:rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0` |
| TEI embedding | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` |
| TEI reranker | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` |

Why these:

- **vLLM**: a ROCm 10.1 build of vLLM 0.29.x — version parity with this
  repo's NVIDIA pin (`vllm/vllm-openai:v0.29.0`), same flag surface.
  Guided JSON (`response_format={"type":"json_object"}`) verified on
  gfx1151 — the dataprep chunk-labeling pipeline REQUIRES it; keep that
  requirement in any future image bump.
- **TEI**: the official ROCm image
  (`text-embeddings-inference:rocm-latest`) targets Instinct dGPUs
  (gfx9) and **fails on gfx1151** — the backend starts, then dies on the
  first embed request. The CPU image is the measured winner:
  `BAAI/bge-large-en-v1.5` and `BAAI/bge-reranker-v2-m3` serve fine on 32
  cores and claim zero GPU. TEI pods therefore need NO GPU resources.

## Sizing (env.strixhalo)

| Variable | Value |
|---|---|
| `VLLM_GPU_UTILIZATION` | `0.28` (~12.8 GiB claim: ~4.3 GiB weights + ~3.8 GiB KV + runtime overhead) |
| `VLLM_MAX_MODEL_LEN` | `49152` |
| `VLLM_MAX_NUM_SEQS` | `16` |
| `VLLM_DTYPE` | `half` |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.12` (gemma-3-1b-it: ~2 GiB weights + an 8192 KV window, with margin) |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `16` |
| `VLLM_TRANSLATION_DTYPE` | `auto` |
| `VLLM_LLM_MODEL_ID` | `ibm-granite/granite-3.1-2b-instruct` |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-1b-it` |
| `DOCLING_DEVICE` | `cpu` (no docling ROCm support) |

The shipped values target a **shared host**: total GPU-tier claims plus
the GTT baseline plus runtime overhead must stay under the operator's
**27 GB** ceiling (decision 2026-11-11; the 8B-class pair cannot fit —
gemma-3-4b-it's weights alone measure 8.58 GiB). The 8B-class models on a
mostly-dedicated host: 0.55 / 49152 fits the 45.8 GiB aperture with
neighbors stopped (~39 GB peak). **65536 does NOT fit** even there: it
needs ~10 GiB KV at 0.55, and the engine's own estimate for that split
was max 54064. Window sizing is hardware math, not a tuning preference.
Both vLLM claims additionally count against the host's 91 GB system RAM
— size chart requests/pods accordingly on a co-tenanted node.

## Task-14 addendum — the ROCm fleet is FOUR vLLM instances

Post-spike (Task 14 + its embedding mirror, 2026-11-18) the ROCm profile
runs FOUR vLLM instances, not the two sized above: llm, translation, and
two pooling instances — `vllm-reranker` (serves
`BAAI/bge-reranker-v2-m3` via `/v1/rerank`, Cohere response shape) and
`vllm-embedding` (serves `BAAI/bge-large-en-v1.5` as a pooling model via
`/v1/embeddings`, OpenAI shape), each at 0.05 of the GTT. Consumers are
switched per deployment: `RERANKER_BACKEND=vllm` points the reranker
wrapper at the reranker instance; `EMBEDDING_BACKEND=vllm` moves BOTH
embedding consumers (dataprep corpus + retriever queries) to the
embedding instance — the pair moves together, a split would mix vector
spaces in one collection. A chart rendering this profile therefore needs
four vLLM workloads plus the two backend switches in the consumers' env.
Sizing rows to add: `VLLM_RERANKER_GPU_UTILIZATION=0.05` /
`VLLM_RERANKER_MAX_MODEL_LEN=8192`; the embedding mirror ships overlay
defaults (`VLLM_EMBEDDING_GPU_UTILIZATION=0.05` /
`VLLM_EMBEDDING_MAX_MODEL_LEN=512`).

The "TEI pods serve bge-large and bge-reranker" shape described above
(and in validation step 6) is the NVIDIA path only. On this profile the
two TEI containers still start (CPU image, zero GTT) but serve nothing
on the single-server venue — both consumers read the vLLM pooling
instances. On the compose SPLIT venue the node-side `/embed` route stays
TEI (there is no `vllm-embedding` service node-side), so a chart should
model the TEI workloads as the fallback shape, not the serving path.

## Device access (what the compose path does)

The working compose passthrough on this machine:

```yaml
devices:
  - /dev/kfd:/dev/kfd
  - /dev/dri:/dev/dri
group_add: [990, 44]   # render, video — distro-specific GIDs
```

Guidance for the charts:

- Route GPU access through the **AMD GPU device plugin** (extended
  resource) or equivalent; the containers need `/dev/kfd` + `/dev/dri`.
- Run the vLLM containers with the host's `render` + `video` group IDs —
  measure them on the target host (`getent group render video`); 990/44
  are the reference Ubuntu host's values, not constants.
- Suggested node label for scheduling: `gpu.rocm/gfx1151: "true"` (or
  extend the repo's existing GPU-label convention with the gfx target —
  `gfx1151` is RDNA 3.5 iGPU class, NOT Instinct).
- The NVIDIA mechanism in the charts (`NVIDIA_VISIBLE_DEVICES` /
  `nvidia-container-runtime`) does not apply. ROCm containers ignore the
  env var; neutralize it (`void`) or omit it — do not carry NVIDIA
  runtime assumptions into the ROCm values.
- Dataprep's docling runs CPU-side on this path (`DOCLING_DEVICE=cpu`);
  if the charts serve docling remotely, CPU scheduling is expected there.

## k3d validation steps

The reference machine keeps a `k3d-dev-cluster` kubectl context for
exactly this work. Suggested sequence:

1. Point kubectl at the k3d cluster and label the GPU node (see label
   suggestion above).
2. Install the AMD GPU device plugin and confirm the extended resource
   shows up allocatable on the gfx1151 node (`kubectl describe node`).
3. Probe pod before the charts: run `rocm/rocm-terminal:latest` with the
   GPU resource + render/video groups; `rocminfo` must list `gfx1151`
   (AMD RYZEN AI MAX+ 395 w/ Radeon 8060S).
4. Deploy the charts with `values-rocm.yaml` — **to be authored under
   #2015; it does not exist yet** (neither in this repo nor in
   `genie-ai-deploy`). Watch the vLLM pod pull and
   load granite-3.1-2b-instruct (`/health`, then `/v1/models`). First
   load downloads ~4 GB from Hugging Face (`HUGGING_FACE_HUB_TOKEN`
   required; gemma-3-1b-it is license-gated on the same token).
5. Verify guided JSON: one chat completion with
   `response_format={"type":"json_object"}` must return valid JSON.
6. Verify the TEI CPU pods: `/embed` returns vectors for bge-large,
   `/rerank` scores for bge-reranker-v2-m3.

## Swarm vs Kubernetes distinction

Docker Swarm **cannot** run this GPU tier as swarm services: `docker
stack deploy` ignores compose `devices:` (the short form is silently
dropped; the long form is rejected — `services.*.devices.0: must be a
string`). This repo's swarm venue therefore routes the GPU tier through
the standalone GPU-node compose stack on the ROCm node, and the compose
topologies use plain `docker compose up` with `-f` overlays.

**Kubernetes does not have this limitation** — a device plugin passes
`/dev/kfd` + `/dev/dri` cleanly and schedules on GPU capacity. The charts
are the *better* long-term venue for the ROCm GPU tier, not a compromised
one; the compose overlays here are the stopgap that proved the images and
the sizing.
