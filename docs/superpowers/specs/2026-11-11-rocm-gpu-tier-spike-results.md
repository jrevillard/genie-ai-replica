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
