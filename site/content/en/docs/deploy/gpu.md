---
title: "GPU Deployment"
description: "GPU deployment profiles for GENIE.AI (NVIDIA: T4, RTX 6000, A40; AMD ROCm: Strix Halo) with model-memory sizing and verification steps."
weight: 4
section: "deploy"
aliases:
  - /docs/deployment/gpu/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-11-17
---

This guide covers how to deploy GENIE.AI's AI layer on GPUs: choosing the
right NVIDIA profile (T4 / RTX 6000 / A40), understanding the variables in
`env.t4` and `env.rtx6000`, sizing VRAM, verifying the stack after
deployment — and the AMD ROCm path (Strix Halo iGPU) via compose overlays
and `env.strixhalo`.

For full end-to-end installation see
[Install Guide](/docs/deploy/install-guide/) (single-node) or
[Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) (multi-node). This
page is the GPU-specific layer on top of those.

## Prerequisites

- **NVIDIA Driver** installed on the GPU node. See
  [NVIDIA Driver Installation Quickstart](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html#driver)
  for the current matrix.
- **NVIDIA Container Toolkit** installed and configured — see
  [NVIDIA Container Toolkit overview](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html).
  Verify with: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`.
- **Docker Engine 23+** with Compose v2.
- **Swarm initialized** if you plan to deploy via `docker stack deploy`:
  `docker swarm init`.
- **GPU node labeled**:
  `docker node update --label-add gpu=true $(hostname)`.
- **`.env` file** created from the project `env` template (`cp env .env`) with
  secrets set.

## Loading environment files

`docker stack deploy` does **not** support `--env-file`. The supported pattern
is to source the files in the shell, resolve `${VAR}` references into a flat
YAML with `docker compose config`, then deploy the resolved file:

```bash
# CORRECT — pre-resolve env, then deploy
set -a && source .env && source env.t4 && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai

# WRONG — docker stack deploy ignores --env-file
docker stack deploy --env-file .env -c docker-compose.yaml genieai
```

`docker compose up` (single-host dev) **does** accept `--env-file`:

```bash
docker compose --env-file .env --env-file env.t4 \
  --profile opea --profile gpu-models up -d
```

## Available GPU profiles

### T4 (16 GB VRAM) — conservative

For development, testing, and small knowledge bases. The values come from
`env.t4`:

```bash
cp env .env
# edit .env with secrets
set -a && source .env && source env.t4 && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai
```

| Variable | T4 value (`env.t4`) | Source file |
|---|---|---|
| `VLLM_GPU_UTILIZATION` | `0.4` | env.t4 (overrides compose default 0.55) |
| `VLLM_MAX_MODEL_LEN` | `2048` | env.t4 (overrides compose default 65536) |
| `VLLM_MAX_NUM_SEQS` | `64` | env.t4 (overrides compose default 16) |
| `VLLM_DTYPE` | `half` | env.t4 (overrides compose default — but `half` in both) |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.3` | env.t4 (overrides compose default 0.3 — same value) |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `2048` | env.t4 (overrides compose default 2048 — same value) |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `16` | env.t4 (overrides compose default 16 — same value) |
| `VLLM_TRANSLATION_DTYPE` | `half` | env.t4 (overrides compose default `auto`) |

TEI image: `ghcr.io/huggingface/text-embeddings-inference:1.9.3` (unified for
all GPU profiles; not set per-profile).

### RTX 6000 ADA (24 GB VRAM) — production

For production workloads. Values from `env.rtx6000`:

```bash
cp env .env
# edit .env with secrets
set -a && source .env && source env.rtx6000 && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai
```

| Variable | RTX 6000 value (`env.rtx6000`) | Source file |
|---|---|---|
| `VLLM_GPU_UTILIZATION` | `0.55` | env.rtx6000 (overrides compose default 0.55) |
| `VLLM_MAX_MODEL_LEN` | `65536` | env.rtx6000 (overrides compose default 65536) |
| `VLLM_MAX_NUM_SEQS` | `16` | env.rtx6000 (overrides compose default 16) |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.4` | env.rtx6000 (overrides compose default 0.3) |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` | env.rtx6000 (overrides compose default 2048) |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `32` | env.rtx6000 (overrides compose default 16) |

`VLLM_DTYPE` is not set in `env.rtx6000`, so it falls back to the compose
default (`half` at `docker-compose.yaml:804`).

### A40 (48 GB) — workshop / development VM

The A40 ships on cloud GPUs (e.g. E2E Networks workshop images) and has its own
walkthrough for getting Ubuntu 22.04 + NVIDIA driver ready before deploying
GENIE.AI on it. See [NVIDIA A40 Install Guide](/docs/deploy/a40-install/).
After the OS + driver + Docker prerequisites, follow the standard
[Docker Swarm Setup](/docs/deploy/docker-swarm-setup/#step-13-single-node-swarm)
with no GPU-specific `env.*` file — the A40 has enough VRAM for the compose
defaults.

### No GPU overrides (default)

Local development without specific GPU settings. Deploy without sourcing
`env.t4` or `env.rtx6000`:

```bash
cp env .env
# edit .env with secrets
set -a && source .env && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai
```

This uses the compose defaults (e.g. `VLLM_GPU_UTILIZATION=0.55`,
`VLLM_MAX_MODEL_LEN=65536`, `VLLM_DTYPE=half`).

## ROCm (AMD Strix Halo / gfx1151)

The AMD path deploys the same four GPU-tier services (two vLLM instances +
two TEI instances) on an AMD Radeon iGPU through compose **overlay files** —
the base files and the NVIDIA path are never edited. Values below were
measured on the reference machine: AMD Ryzen AI MAX+ 395 "Strix Halo",
Radeon 8060S iGPU, `gfx1151`, 91 GB unified LPDDR5X.

### Host prerequisites

- **In-tree `amdgpu` kernel driver** with `/dev/kfd` and
  `/dev/dri/renderD128` present. **No host ROCm userland is needed** — the
  containers carry it. **No NVIDIA Container Toolkit either.**
- **Device group access**: the overlay passes the host's `render` + `video`
  GIDs into the containers (`RENDER_GID` / `VIDEO_GID` in `env.strixhalo` —
  distro-specific; measure with `getent group render video`. 990 / 44 on
  the reference Ubuntu host).
- Verify the GPU is visible from a container:

```bash
docker run --rm --device=/dev/kfd --device=/dev/dri \
  --group-add 990 --group-add 44 \
  rocm/rocm-terminal:latest rocminfo
# Look for: gfx1151 (AMD RYZEN AI MAX+ 395 w/ Radeon 8060S)
```

### Image pins (carried by `env.strixhalo`)

| Variable | Image | Why |
|---|---|---|
| `VLLM_ROCM_IMAGE` | `rocm/vllm:rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0` | ROCm 10.1 build of vLLM 0.29.x — version parity with the NVIDIA pin (`vllm/vllm-openai:v0.29.0`); guided JSON verified (dataprep requirement) |
| `TEI_ROCM_EMBEDDING_IMAGE` | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` | TEI CPU fallback — see below |
| `TEI_ROCM_RERANKING_IMAGE` | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3` | TEI CPU fallback — see below |

### Overlay invocations

The overlays layer on top of the untouched base files with `-f`, and the
ROCm file must come **last** (verbatim from the overlay headers):

```bash
# Single-server: main stack, GPU tier on the local iGPU
docker compose --env-file env.strixhalo \
  -f docker-compose.yaml -f docker-compose.rocm.yaml \
  --profile opea --profile gpu-models up -d

# Split topology: standalone GPU-node stack on the ROCm node
docker compose --env-file env.strixhalo \
  -f docker-compose.gpu.yaml -f docker-compose.rocm.gpu.yaml up -d
```

`HUGGING_FACE_HUB_TOKEN` must reach the containers — set it in the
environment or put `--env-file .env` ahead of `--env-file env.strixhalo`.
The overlays restate only what a ROCm host needs: the image pins, GPU
device access (`devices: /dev/kfd + /dev/dri` with `group_add`) and
`NVIDIA_VISIBLE_DEVICES=void` (compose merges `environment:` by key, so
omitting the var would NOT remove it; `void` claims no GPU and is ignored
by ROCm containers). Everything else merges from the base files. The TEI
services need no device access (CPU image). For the Ansible path,
`deploy/ansible/deploy-gpu-rocm.yml` +
`group_vars/rocm_gpu_api/vars.yml` drive the same GPU-node stack.

### Window / memory sizing

There is no discrete VRAM: vLLM claims fractions of the **GTT aperture** —
measured 45.8 GiB (`rocm-smi --showmeminfo gtt`) — which is carved from the
91 GB system RAM, so GPU-tier claims add to the host's RAM pressure. The
shipped `env.strixhalo` sizing targets a **shared** host: total GPU-tier
claims plus the GTT baseline and runtime overhead must stay under the
operator's ceiling, **27 GB** (decision 2026-11-11; the first sizing round
proved the 8B-class pair cannot fit — gemma-3-4b-it's weights alone
measure 8.58 GiB).

| Variable | `env.strixhalo` | Note |
|---|---|---|
| `VLLM_GPU_UTILIZATION` | `0.28` | ~12.8 GiB claim (~4.3 GiB weights + ~3.8 GiB KV + runtime overhead) |
| `VLLM_MAX_MODEL_LEN` | `49152` | the verified window at 0.28 (a 65536 window needs 5.0 GiB KV and does not fit there) |
| `VLLM_MAX_NUM_SEQS` | `16` | |
| `VLLM_DTYPE` | `half` | |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.12` | gemma-3-1b-it (~2 GiB weights + an 8192 KV window, with margin) |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` | |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `16` | |
| `VLLM_TRANSLATION_DTYPE` | `auto` | |

Coexistence verified: both instances healthy together, peak GTT
**19.6 GiB** against the 27 GB budget. The 8B-class models
(granite-4.1-8b + gemma-3-4b-it) need a **mostly-dedicated** host: `0.55`
/ `49152` fits the 45.8 GiB aperture with neighbors stopped (~39 GB peak;
~16.5 GiB weights + 8.25 GiB KV). Window sizing here is hardware math,
not a tuning preference: at 0.55 a 65536 window needs ~10 GiB KV and does
**not** fit — the engine's own estimate for that split was 54064.

### Why TEI runs on CPU

The official TEI ROCm image (`text-embeddings-inference:rocm-latest`)
targets Instinct dGPUs (gfx9); on gfx1151 the backend dies on the first
embed request. The CPU image serves `bge-large-en-v1.5` and
`bge-reranker-v2-m3` fine on 32 cores and claims **zero GTT** — the whole
aperture stays available to the two vLLM instances. The base compose TEI
entrypoint flags work unchanged on the CPU image.

### Verifying the ROCm GPU stack

```bash
# 1. Device visible (see host prerequisites above — rocminfo lists gfx1151)

# 2. Model endpoints (single-server venue)
docker compose exec vllm curl -s http://localhost:8000/health
docker compose exec vllm curl -s http://localhost:8000/v1/models
# → ['ibm-granite/granite-3.1-2b-instruct']

# 3. Guided JSON — a chat completion with
#    response_format={"type":"json_object"} must return valid JSON
#    (dataprep chunk labeling depends on it)

# 4. GTT usage
docker run --rm --device=/dev/kfd --device=/dev/dri \
  --group-add 990 --group-add 44 \
  rocm/rocm-terminal:latest rocm-smi --showmeminfo gtt
```

### Swarm caveat

`docker stack deploy` does **not** pass compose `devices:` — the short form
is silently dropped and the long form is rejected
(`services.*.devices.0: must be a string`). The swarm-deployed ROCm GPU
tier therefore routes via the standalone GPU-node compose stack (second
invocation above) on the ROCm node, wired to the app stack with the
remote-GPU pattern — see
[Docker Swarm Setup](/docs/deploy/docker-swarm-setup/).

### OKF stack on a ROCm venue (live-verified additions)

Running the OKF knowledge-base tier on a ROCm single-server venue needs
four venue-only settings (all in the local `.env` / the ROCm overlay —
no NVIDIA-path file changes):

1. **`OKF_ENABLED=1`** + `--profile okf` + a kong-config re-run — see
   [OKF Deployment & Lifecycle](/docs/knowledge-base/okf-deployment/)
   for the full flag semantics.
2. **Split-URL auth for okf-server AND document-repository** — the ROCm
   overlay (`docker-compose.rocm.yaml`) carries the
   `KEYCLOAK_DISCOVERY_URL` / `KEYCLOAK_JWKS_URL` /
   `KEYCLOAK_PUBLIC_URL` trio for three services now: backend,
   okf-server, document-repository. Document-repository's block is what
   makes OKF publishing work (its OIDC discovery otherwise times out
   against the self-signed edge and bundle storage answers 503 →
   `EXPORT_FAILED` on publish).
3. **`VLLM_ENDPOINT=http://vllm:8000`** — opts okf-server's LLM legs in
   (LLM-Assisted import curation, topic links, manifest summaries).
   Unset, those legs refuse ("LLM not configured") and the wizard
   stalls. Other consumers of the variable already default to the same
   URL, so the setting moves only okf-server.
4. **TLS cert SAN** — the nginx dev generator stamps
   `subjectAltName=IP:<NGINX_PUBLIC_DOMAIN>|DNS:<NGINX_PUBLIC_DOMAIN>,DNS:localhost,IP:127.0.0.1`.
   Older images (pre-fix) generate a SAN-less cert whose symptoms are
   browser `ERR_CERT_AUTHORITY_INVALID` on API calls and the frontend
   falling back to `localhost:3000` — rebuild the nginx image and
   recreate the container to regenerate with the SAN.

Topic-link enrichment on the 2B-class ROCm models: batches of 8 concepts
sometimes exceed the 60 s per-call budget (measured 7 of 19 batches on a
144-concept import — fail-soft, the run completes). Tune
`OKF_TOPIC_LINK_TIMEOUT_MS` / `OKF_TOPIC_LINK_BATCH` and re-run the pass
to densify links. The full live-venue runbook — Keycloak role seeding,
the OKF lifecycle via API, and every failure signature — is
`docs/rocm-venue-okf-runbook.md` in the repository.

## Verifying the GPU stack

After deploy, **wait** for vLLM to load the model. On first run this includes
the model download from Hugging Face Hub and can take 2–10 minutes depending on
network and disk.

```bash
# 1. Confirm the vLLM task is running on the gpu node
docker service ps genieai_vllm --no-trunc

# 2. Tail vLLM logs and wait for startup
docker service logs genieai_vllm -f
# Look for: "Application startup complete"

# 3. Verify the model endpoint responds
docker exec $(docker ps -q -f name=genieai_vllm) \
  curl -s http://localhost:8000/v1/models

# 4. Confirm GPU usage
nvidia-smi
```

If any service stays in `Preparing` or `Restarting`, see [Troubleshooting](#troubleshooting).

## Sizing VRAM

Use these formulas to plan:

```
Available VRAM   = Total VRAM × VLLM_GPU_UTILIZATION
Effective VRAM   = Available VRAM − (model weights + activations + KV cache)
```

Approximate model weights (FP16) for the project defaults shipped with the compose / env templates:

| Model | Role | Approx. weight |
|---|---|---|
| `meta-llama/Meta-Llama-3.1-8B-Instruct` | Main LLM (`VLLM_LLM_MODEL_ID` default) | ~16 GB |
| `google/gemma-3-4b-it` | Translation LLM (`VLLM_TRANSLATION_MODEL_ID` default) | ~8 GB |
| `BAAI/bge-large-en-v1.5` | Embedding (`EMBEDDING_MODEL_ID` default) | ~1.3 GB |
| `BAAI/bge-reranker-v2-m3` | Reranker (`RERANKER_MODEL_ID` default) | ~1 GB |

For smaller GPUs, swap in lighter defaults via `.env` (e.g. a 2B/3B chat model and a MiniLM reranker) — the weight column above shows the shipped baselines.

Examples using `env.t4` values:

| GPU | Total | Utilization | Available for vLLM |
|---|---|---|---|
| T4 (16 GB) | 16 GB | 0.4 | 6.4 GB |
| RTX 6000 (24 GB) | 24 GB | 0.6 | 14.4 GB |

If you see out-of-memory errors, lower `VLLM_GPU_UTILIZATION` and/or
`VLLM_MAX_MODEL_LEN`.

## Tuning checklist

- Increase `VLLM_MAX_MODEL_LEN` only if you have VRAM headroom (each doubling
  roughly doubles KV-cache memory).
- Increase `VLLM_MAX_NUM_SEQS` to raise concurrency at the cost of more
  per-request memory.
- Keep `VLLM_DTYPE=half` on consumer GPUs without bf16 support. Use `bfloat16`
  on Ampere or newer if the model supports it.
- Translation uses a separate `vllm-translation-guardrail` container — its
  `VLLM_TRANSLATION_*` variables are independent of the main `VLLM_*` ones.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cudaErrorNoDevice` or "could not select device driver" on `vllm`/`tei` startup | GPU node missing the `gpu=true` label, or the NVIDIA runtime is not registered with Docker | `docker node update --label-add gpu=true $(hostname)` then `docker info \| grep -i runtime` (should list `nvidia`). Redeploy the stack. |
| vLLM logs show `CUDA out of memory` or `torch.cuda.OutOfMemoryError` | GPU has too little VRAM for the configured model/context | Lower `VLLM_GPU_UTILIZATION` (e.g. `0.4` on T4), `VLLM_MAX_MODEL_LEN` (e.g. `2048`), and/or `VLLM_MAX_NUM_SEQS` (e.g. `16`). Re-source env, redeploy. |
| Model Too Long error at request time | Retriever returned chunks exceeding the model's context window | Reduce retriever output (e.g. set `RETRIEVER_ARANGO_K=4`, `RETRIEVER_ARANGO_FETCH_K=20` as commented example overrides in the `env` template at lines 172-173) and/or lower `VLLM_MAX_MODEL_LEN=2048` |
| `vllm` task stays in `Preparing` or `Restarting` for >10 min | Model still downloading from Hugging Face Hub on first run (2–10 min typical) | Check `docker service logs genieai_vllm -f` for download progress. Wait, or pre-pull to the `hf_cache` volume (declared at `docker-compose.yaml:64`, bound to `./data/huggingface` per the path comment at line 56). |
| `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` reports "could not access GPU" | NVIDIA driver not loaded, or container toolkit not configured | `nvidia-smi` on the host first; then re-install NVIDIA Container Toolkit per [NVIDIA docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html). |

More diagnostic commands:

```bash
# Host-side driver check
nvidia-smi

# In-container runtime check (proves the toolkit is wired correctly)
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi

# Docker runtime registration check (single-node Swarm)
docker info | grep -i runtime
# Should include: nvidia

# GPU label check on the current Swarm node
docker node inspect $(hostname) --format '{{.Spec.Labels}}'
# Should contain: map[gpu:true ...]
```

## Remote GPU node (separate host)

For production topologies where AI services run on a dedicated GPU node
separate from the app stack, see
[Docker Swarm Setup → Remote GPU Node](/docs/deploy/docker-swarm-setup/#remote-gpu-node)
and set `GPU_NODE_HOST`, `VLLM_API_KEY`, and (for self-signed certs)
`OPEA_SSL_SKIP_VERIFY=1` on the app node.

## Kubernetes GPU modes

On Kubernetes the GPU is chosen by `opea.gpu.mode` — the switch is
binary, and it decides where the model weights live and which knobs
apply. There is no `GPU_NODE_HOST` and no `env.t4` / `env.rtx6000`
profile override on this path.

| Mode | Models run | Knobs |
|---|---|---|
| `external` (default) | On a standalone GPU node reachable over HTTPS | `opea.gpu.nodeHost` (e.g. `https://gpu-node:444`), `opea.gpu.paths.{llm,embedding,reranker,translation,docling}`, `opea.gpu.skipTlsVerify`, `opea.gpu.allowedCIDRs` |
| `in-cluster` | On pods scheduled to the GPU nodes of the cluster itself | `opea.models.nodeSelector` (defaults to `{gpu: "true"}`), the model weights on a ReadWriteOnce PVC (`opea.models.cache`) |

**`external`** needs no GPU in the cluster — it points at an endpoint you
operate. The chart refuses to render it without `opea.gpu.nodeHost`
rather than shipping an empty GPU URL.

**`in-cluster`** needs the NVIDIA device plugin installed and the GPU
nodes labelled — the chart selects them through `opea.models.nodeSelector`,
which **replaces** the default map outright, so declare every label your
pods need:

```bash
# the NVIDIA device plugin must be installed on the cluster
kubectl label node <gpu-node> gpu=true
```

If your cluster uses the NVIDIA GPU Feature Discovery labels instead
(`nvidia.com/gpu.present=true`), set the map in your overlay rather than
relabelling the node.

Both modes authenticate with the `vllm-api-key` Secret (`VLLM_API_KEY`,
and `HF_TOKEN` for the gated models).

## Related docs

- [Install Guide](/docs/deploy/install-guide/) — canonical end-to-end deploy + env var reference
- [Docker Compose Setup](/docs/deploy/docker-compose-setup/) — single-host `docker compose up` flow
- [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) — multi-node Swarm + node labels + remote GPU
- [Kubernetes Deployment](/docs/deploy/kubernetes/) — the Helm chart path, GPU modes and cluster prerequisites
- [NVIDIA A40 Install Guide](/docs/deploy/a40-install/) — pre-flight for 48 GB A40 hardware (Ubuntu 22.04 + NVIDIA driver)

## Resources

- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html)
- [vLLM GPU Memory Utilization](https://docs.vllm.ai/en/latest/configuration/engine_args.html#gpu-memory-utilization)
- [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
