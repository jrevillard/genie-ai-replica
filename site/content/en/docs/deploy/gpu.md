---
title: "GPU Deployment"
description: "GPU deployment profiles for GENIE.AI (T4, RTX 6000, A40) with model-memory sizing and verification steps."
weight: 4
section: "deploy"
aliases:
  - /docs/deployment/gpu/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This guide covers how to deploy GENIE.AI's AI layer on NVIDIA GPUs: choosing
the right profile (T4 / RTX 6000 / A40), understanding the variables in
`env.t4` and `env.rtx6000`, sizing VRAM, and verifying the stack after
deployment.

For full end-to-end installation see
[Install Guide](/docs/deploy/install-guide/) (single-node) or
[Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) (multi-node). This
page is the GPU-specific layer on top of those.

## Prerequisites

- **NVIDIA Driver** installed on the GPU node. See
  [NVIDIA Driver Installation Quickstart](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html#driver)
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
| `VLLM_GPU_UTILIZATION` | `0.6` | env.rtx6000 (overrides compose default 0.55) |
| `VLLM_MAX_MODEL_LEN` | `4096` | env.rtx6000 (overrides compose default 65536) |
| `VLLM_MAX_NUM_SEQS` | `1024` | env.rtx6000 (overrides compose default 16) |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.4` | env.rtx6000 (overrides compose default 0.3) |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` | env.rtx6000 (overrides compose default 2048) |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `32` | env.rtx6000 (overrides compose default 16) |

`VLLM_DTYPE` is not set in `env.rtx6000`, so it falls back to the compose
default (`half` at `docker-compose.yaml:759`).

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
| `BAAI/bge-base-en-v1.5` | Embedding (`EMBEDDING_MODEL_ID` default) | ~0.5 GB |
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
| `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` reports "could not access GPU" | NVIDIA driver not loaded, or container toolkit not configured | `nvidia-smi` on the host first; then re-install NVIDIA Container Toolkit per [NVIDIA docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html). |

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

## Related docs

- [Install Guide](/docs/deploy/install-guide/) — canonical end-to-end deploy + env var reference
- [Docker Compose Setup](/docs/deploy/docker-compose-setup/) — single-host `docker compose up` flow
- [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) — multi-node Swarm + node labels + remote GPU
- [NVIDIA A40 Install Guide](/docs/deploy/a40-install/) — pre-flight for 48 GB A40 hardware (Ubuntu 22.04 + NVIDIA driver)

## Resources

- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/overview.html)
- [vLLM GPU Memory Utilization](https://docs.vllm.ai/en/latest/serving/usage.html#gpu-memory-utilization)
- [Text Embeddings Inference](https://github.com/huggingface/text-embeddings-inference)
