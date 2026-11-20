# ROCm Spike Results — Strix Halo (gfx1151)

Companion to `2026-11-11-rocm-gpu-tier-design.md`. Every value here was
measured on the local machine, 2026-11-11. Downstream tasks consume these
pins and numbers — never invent new ones.

## Device access (Task 1)

- Host GIDs: `render=990`, `video=44`
- Working passthrough: `--device=/dev/kfd --device=/dev/dri --group-add 990 --group-add 44`
- `rocminfo` inside `rocm/rocm-terminal:latest` sees `gfx1151`
  (AMD RYZEN AI MAX+ 395 w/ Radeon 8060S) + `gfx11-generic`.
- Probe image: `rocm/rocm-terminal:latest` (ROCm 6.4 userland;
  `rocm/dev-ubuntu` does not exist on Docker Hub — plan tag corrected).
- Kernel: in-tree `amdgpu` (7.0.0-42-generic); no host ROCm userland
  needed for container operation.

## GTT aperture (Task 1)

- `rocm-smi --showmeminfo gtt`: **GTT Total 49,218,076,672 B (45.8 GiB)**,
  baseline used 4,752,195,584 B (4.4 GiB) at probe time.
- The aperture is ~half of the 91 GB system RAM and is carved from it:
  GPU-tier claims add to the system-RAM pressure of the co-resident
  projects (genie-ai-naat, jarvis, ruskdesk, k3d).
- `mem_info_gtt_size` sysfs node does not exist on this kernel — read GTT
  via `rocm-smi` inside a container instead.
- Sizing consequence: `gpu_memory_utilization` fractions in
  `env.strixhalo` are fractions of 45.8 GiB, and their sum plus the
  neighbors' footprint must stay under 91 GB system RAM.

## Image landscape (discovered during Task 1 — feeds Task 2 candidates)

`rocm/vllm` on Docker Hub publishes gfx-targeted tags:

| Tag family | vLLM | gfx1151 relevance |
|---|---|---|
| `rocm7.13.0_gfx1151_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1` | 0.19.1 | **explicit gfx1151 build** |
| `rocm7.14.1_rdna_ubuntu24.04_py3.14_pytorch_2.11_vllm_0.23.0` | 0.23.0 | RDNA family (Strix Halo is RDNA 3.5) |
| `rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0` | 0.29.0 | version parity with NVIDIA pin `v0.29.0`; gfx support unstated |

Candidate order for Task 2: gfx1151-dedicated → rdna → rocm10.1.0.

## Candidate matrix (Task 2 — in progress)

The `rocm/vllm` tags are BUILDER images: their default CMD reinstalls a
gfx-tuned vLLM wheel from `rocm.frameworks.amd.com`; there is no serving
entrypoint. Production form: one-time derivation (`docker run` default CMD
→ `docker commit` → serve from the committed image), recorded per
candidate below. Serving from the builder image directly would re-run the
pip install on every container start.

### Candidate 1 — `rocm/vllm:rocm7.13.0_gfx1151_..._vllm_0.19.1`

- Derived local image: `rocm-vllm-gfx1151-ready:0.19.1`
- granite-4.1-8b @ `--gpu_memory_utilization 0.55 --max_model_len 49152
  --max_num_seqs 16 --dtype half --enforce-eager`:
  - `/health` OK; `/v1/models` → `['ibm-granite/granite-4.1-8b']`
  - completion: `'OK'`, finish `stop`, 3.3 s wall
  - guided JSON (`response_format: json_object`): valid JSON returned,
    2.5 s wall → **dataprep requirement met**
- Memory finding (first attempt, 65536 window): 0.55 × 45.8 GiB leaves
  8.25 GiB KV; a 65536 window needs ~10 GiB (engine estimate: max
  54064). **The 65536 window does not fit this iGPU at 0.55** — window
  sizing is a hardware-math conclusion, not a tuning preference.
- Coexistence budget (GTT 45.8 GiB, ~4.4 GiB baseline): main + translation
  claims must stay ≤ ~41 GiB.

Pending: gemma-3-4b-it probe (operator HF token, license-gated);
candidates 2/3 (rdna 0.23, rocm10.1.0 vLLM 0.29.0) for version parity —
newest passing tag wins the pin.

### Candidate 3 — `rocm/vllm:rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0` — **WINNER (pending gemma)**

- vLLM `0.29.1.dev0+g98dff2a81.rocm101`, torch 2.13.0+rocm10.1.0
  preinstalled; default CMD is `/bin/bash` — **a plain serving
  environment, no wheel-install derivation needed** (unlike candidate 1).
- granite-4.1-8b @ 0.55 / 49152 / half / eager: `/health` OK, completion
  OK, guided JSON valid.
- Version parity with the NVIDIA pin (`vllm/vllm-openai:v0.29.0` ≈
  0.29.x) — same flag surface and guided-JSON behavior dataprep validated
  against on NVIDIA.
- Candidate 2 (`rocm7.14.1_rdna_..._vllm_0.23.0`) skipped: bracketed by
  two passing points (0.19.1, 0.29.1); no signal it would add.

**Task 5/9/11 pin: `VLLM_IMAGE=rocm/vllm:rocm10.1.0_ubuntu24.04_py3.14-pytorch_2.13.0_vllm-0.29.0`**
(the variable was named `VLLM_ROCM_IMAGE` while the vendor axis lived in
compose overlays — renamed 2026-11-19 when the axis collapsed into the
base files)
— verified serving BOTH deployment models with guided JSON on gfx1151
(see Final sizing below).

### Final sizing (operator decisions, 2026-11-11 — three rounds)

The ceiling moved twice as the operator measured what the shared host
could give the GPU tier: 32 GB → 27 GB. The 8B-class pair cannot fit:
gemma-3-4b-it's weights measured **8.58 GiB** (multimodal vision+text;
KV pool went **negative** at 0.19 utilization → engine exit), and
granite-4.1-8b needs ~16.5 GiB. Operator chose the model swap:

| Instance | Model | util | window | weights (measured/est.) |
|---|---|---|---|---|
| main | `ibm-granite/granite-3.1-2b-instruct` | 0.28 | 49152 | ~4.3 GiB |
| translation | `google/gemma-3-1b-it` | 0.12 | 8192 | ~2 GiB |

- 65536 does not fit at 0.28 either: granite-3.1-2b needs **5.0 GiB KV**
  for a 65536 window and ~4.9 GiB is available at 0.28 (engine estimate
  at 0.25: max 45616). 49152 is the verified window with ~1 GiB KV
  margin.
- **Coexistence verified**: both instances healthy simultaneously,
  translation completion + guided JSON both pass, peak GTT
  **21,087,858,688 B (19.6 GiB)** against the 45.8 GiB aperture and the
  27 GB operator ceiling (Jarvis stopped; GTT baseline 1.08 GiB).
- Engine runtime overhead per instance ≈ 2 GiB beyond weights+KV —
  budget accordingly on other hosts.
- dataprep doc budget at 49152 ≈ 190k chars vs the 250k OKF ceiling —
  near-zero truncation expected; check the ingestion log.

## Task 3 — TEI

- Official TEI ROCm image: `ghcr.io/huggingface/text-embeddings-inference:rocm-latest`
  — docs scope it to Instinct MI200/MI300 (gfx9); gfx1151 explicitly
  "work in progress". iGPU attempt then CPU fallback
  (`cpu-<ver>` tag) per design.
- **iGPU attempt FAILED** as the docs warned: python backend starts, first
  embed kills it (`Server error: transport error` → backend terminated →
  "Model backend is not healthy"). gfx1151 kernels absent.
- **DECISION — CPU fallback wins**: `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3`
  for BOTH `tei` and `tei_reranker`.
  - bge-large-en-v1.5: `/health` OK, `/embed` returns vectors.
  - bge-reranker-v2-m3: `/health` OK, `/rerank` scores correctly
    (relevant 1.0 vs irrelevant 0.0).
  - Zero GTT claims (GTT unchanged while running) — the whole 45.8 GiB
    aperture stays available to the two vLLM instances. 32 CPU cores are
    ample for bge-scale models.
  - Base compose entrypoint flags (`--json-output --auto-truncate
    --max-batch-tokens`) work unchanged on the CPU image — the overlay
    need only restate `image` + environment, not the entrypoint.

## Task 4 — Passthrough verdicts

- **Compose: WORKS.** `devices: [/dev/kfd, /dev/dri]` + `group_add: [990, 44]`
  (render, video) — verified by every vLLM/TEI spike container above.
- **Swarm: DOES NOT pass `devices:`** — `docker stack deploy` of a
  rocminfo probe shows `SWARM-GPU-MISSING` (Docker 29.8.2, single-node
  swarm initialized 2026-11-11 with operator consent), and the compose-
  rendered long-form devices are outright rejected
  (`services.*.devices.0: must be a string`). **Caveat path per design,
  doubly confirmed**: the swarm-deployed ROCm GPU tier runs via the
  standalone GPU-node compose stack (Task 9 overlay) on the ROCm node;
  docs say so.
- Host port plan for the ROCm venues on THIS machine (audit 2026-11-11;
  neighbors occupy 80, 443, 8080, 8025, 8530, 8765–8767, 8790, 9100–9102,
  11434, 21115–21119, 24224–24288, 33306…): **NGINX_HTTP_PORT=8180,
  NGINX_HTTPS_PORT=8443, ARANGO_PORT=18529** in `env.strixhalo`.


## SPIKE-02 (Task 14, 2026-11-18): vLLM pooling/rerank on gfx1151 — PASS

Operator decision: TEI stays default everywhere; add a config-gated second
reranker backend served by a third vLLM instance on the GPU. This spike
verifies the prerequisite the whole task hangs on.

Setup: pinned `rocm/vllm` image (the winner of SPIKE-01), container
`vllm serve BAAI/bge-reranker-v2-m3 --gpu-memory-utilization 0.05
--max-model-len 8192 --enforce-eager --port 8010`, devices kfd/dri,
groups 990/44, HF token. Model download ~1.2 GB; engine ready ~90 s.

| Criterion | Expected | Measured |
|---|---|---|
| `/health` | 200 | **200 OK** |
| `POST /v1/rerank` shape | `{"results": [{index, score}...]}` sorted desc | **200, `results[]` sorted desc — score key is `relevance_score`** (Cohere shape; entries carry `index`, `document`, `relevance_score`) |
| Scoring sanity | relevant doc ≫ irrelevant | **0.9997 vs 2.1e-5 vs ~0** on a 3-doc probe |
| GTT delta | ≈ 2 GiB | **1.56 GiB** (4.71 GiB − 3.15 GiB baseline) |
| Latency | GPU-class | **164 ms warm** (5-doc batch, incl. HTTP) |

Conclusions carried into the implementation:

1. **vLLM 0.29 ROCm build serves cross-encoder pooling on gfx1151** — the
   bge-reranker-v2-m3 (XLMRoberta sequence-classification) loads and scores
   correctly. No ROCm-specific pooling gap.
2. **The response is the Cohere rerank contract**, not TEI's: the wrapper
   normalizes `results[].relevance_score` → `{index, score}` and re-sorts
   defensively; every strategy downstream is backend-agnostic.
3. **Score semantics comparable to TEI** (sigmoid-range: 0.9997 / 2e-5
   spread) — `RERANKING_THRESHOLD` strategies keep their calibration.
4. TEI's strict `truncate=False` 422 contract is TEI-only; vLLM truncates
   silently at the model window — recorded via the `reranker.backend` span
   attribute (vocabulary 113 → 114; the Task-14 embedding mirror added
   `embedding.backend` after it at 114 → 115 — the ladder moved when
   main's dataprep fix added `dataprep.purge_result` at 112 → 113).
5. Sizing: `VLLM_RERANKER_GPU_UTILIZATION=0.05` + `MAX_MODEL_LEN=8192`
   pinned in env.strixhalo — inside the 27 GB ceiling beside granite
   (0.28) + gemma (0.12); frees the CPU reranker's ~5 GiB post-cap host-RAM
   footprint.
