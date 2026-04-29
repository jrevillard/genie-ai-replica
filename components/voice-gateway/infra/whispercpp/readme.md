# voice-stt — whisper.cpp HTTP server

A whisper.cpp-based speech-to-text container with **GPU-first /
CPU-fallback** startup, controlled by `STT_BACKEND`. The default build
runs on any host (no GPU required). GPU acceleration is opt-in via a
separate compose override.

---

## Quick start (CPU, no GPU required)

```bash
# from the repo root
docker compose -f components/docker-compose.yaml build voice-stt
docker compose -f components/docker-compose.yaml up -d voice-stt

# tail the entrypoint decision
docker logs voice-stt | grep '\[voice-stt-entrypoint\]'
```

Expected log line:

```
[voice-stt-entrypoint] decision backend=cpu reason=auto+fallback_to_cpu (cuda_binary_missing(image_built_cpu_only) nvidia-smi_unavailable_or_no_gpu)
[voice-stt-entrypoint] starting whisper-server backend=cpu bin=/usr/local/bin/whisper-server-cpu model=/models/ggml-small.en.bin port=8080 threads=4
```

The CPU image is small (~250 MB) and contains only the CPU whisper-server
binary, so the entrypoint always picks CPU here.

## GPU acceleration (opt-in)

Requires on the Docker host:
- NVIDIA GPU + driver (`nvidia-smi` works on the host)
- `nvidia-container-toolkit` installed
- Docker daemon configured for the nvidia runtime
- Docker Desktop on WSL2: GPU support enabled in settings

```bash
# build the GPU-capable image (~3 GB; takes 10+ minutes the first time
# because both CPU and CUDA whisper.cpp binaries are compiled from source)
docker compose -f components/docker-compose.yaml \
               -f components/docker-compose.gpu.yml \
               build voice-stt

# run it
docker compose -f components/docker-compose.yaml \
               -f components/docker-compose.gpu.yml \
               up -d voice-stt

# verify GPU is being used
docker exec voice-stt nvidia-smi          # should list the GPU
docker logs voice-stt | grep '\[voice-stt-entrypoint\]'
```

Expected log line in GPU mode:

```
[voice-stt-entrypoint] decision backend=cuda reason=auto+gpu_detected device=0
[voice-stt-entrypoint] starting whisper-server backend=cuda bin=/usr/local/bin/whisper-server-cuda model=/models/ggml-small.en.bin port=8080 threads=4
```

If the GPU image is built but the container is started on a host without
a real GPU (or without nvidia-container-toolkit configured),
`STT_BACKEND=auto` will silently fall back to CPU and you'll see:

```
decision backend=cpu reason=auto+fallback_to_cpu (nvidia-smi_unavailable_or_no_gpu)
```

---

## Backend selection — full reference

| `STT_BACKEND` | Behaviour |
|---|---|
| `auto` (default) | Use CUDA if the cuda binary exists *and* `nvidia-smi` reports a GPU. Otherwise CPU. **Never blocks startup**, even on hosts without any GPU support. |
| `cpu` | Always CPU. Never falls back, never tries GPU. |
| `cuda` | Force CUDA. **Fails the container** (exit 2) if CUDA is unavailable, *unless* `STT_ALLOW_FALLBACK=true`. Use this in production when you want to detect a misconfigured host immediately rather than silently degrade. |
| `vulkan` | Force Vulkan. The current `dockerfile` does not yet build a Vulkan binary; setting this will fail (exit 2) unless `STT_ALLOW_FALLBACK=true`. The slot is reserved so a future Vulkan build target slots in cleanly. |

`STT_ALLOW_FALLBACK=true` flips the forced-mode failures into automatic
CPU fallback (with a logged warning). Default is `false` because silent
fallback in production is usually worse than a hard failure that paging
catches.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STT_BACKEND` | `auto` | `auto` / `cpu` / `cuda` / `vulkan` |
| `STT_ALLOW_FALLBACK` | `false` | Permit forced-mode → CPU fallback when the requested backend is unavailable |
| `WHISPER_MODEL` | `/models/ggml-small.en.bin` | Path inside the container |
| `WHISPER_PORT` | `8080` | Listen port |
| `WHISPER_THREADS` | `4` | CPU threads (used in CPU mode primarily) |
| `WHISPER_GPU_DEVICE` | `0` | CUDA device index (sets `CUDA_VISIBLE_DEVICES`) |
| `WHISPER_EXTRA_ARGS` | (empty) | Free-form args appended to whisper-server (advanced) |

---

## Models

Mount your `.bin` (ggml format) or `.gguf` model files into `/models`.
The compose file already mounts `./components/voice-gateway/infra/whispercpp/models/`
which currently contains:

```
ggml-base.en.bin    (148 MB)
ggml-small.en.bin   (487 MB)  <-- default
ggml-medium.en.bin  (1.5 GB)
```

To use a different model, set `WHISPER_MODEL=/models/<filename>` in the
compose env or via `docker run -e`. **Don't change the path or model
choice silently in production** — different models have different
accuracy on medical terminology, names, and dosages.

---

## How testers can verify GPU access

On the **host**:
```bash
nvidia-smi                    # confirms the GPU + driver are visible
docker info | grep -i nvidia  # confirms the nvidia runtime is registered
```

In a **freshly-started container** (with the GPU compose override active):
```bash
docker exec voice-stt nvidia-smi
docker logs voice-stt | grep -E '(decision|starting whisper-server)'
```

If `nvidia-smi` fails inside the container but works on the host, the
`nvidia-container-toolkit` is not configured for the Docker daemon yet.
The entrypoint will fall back to CPU and that line in the logs will tell
you exactly why.

---

## Forcing a specific backend

```bash
# Force CPU regardless of GPU presence:
docker compose -f components/docker-compose.yaml \
               run --rm -e STT_BACKEND=cpu voice-stt

# Force CUDA, fail if missing:
docker compose -f components/docker-compose.yaml \
               -f components/docker-compose.gpu.yml \
               run --rm -e STT_BACKEND=cuda voice-stt

# Force CUDA, but auto-fall-back if missing:
docker compose -f components/docker-compose.yaml \
               -f components/docker-compose.gpu.yml \
               run --rm \
                 -e STT_BACKEND=cuda \
                 -e STT_ALLOW_FALLBACK=true \
                 voice-stt
```

---

## Interpreting fallback logs

Every `decision` line has a `reason=` tag you can grep on:

| `reason=...` | Meaning |
|---|---|
| `forced (STT_BACKEND=cpu)` | Operator pinned CPU; no detection ran |
| `forced+available device=N` | Operator pinned cuda; checks passed; using device N |
| `forced+binary_present` | Vulkan pinned and binary exists in image |
| `auto+gpu_detected device=N` | auto mode chose CUDA (binary + nvidia-smi both OK) |
| `auto+fallback_to_cpu (...)` | auto mode chose CPU; bracketed phrase explains exactly why |
| `cuda_unavailable+fallback_allowed` | forced cuda failed but `STT_ALLOW_FALLBACK=true` |

Inside the parenthesized fallback reason you may see:
- `cuda_binary_missing(image_built_cpu_only)` — image was built without
  the GPU target. To enable GPU you must add the gpu compose override.
- `nvidia-smi_unavailable_or_no_gpu` — image has the binary but the
  runtime cannot see a GPU. Check `nvidia-container-toolkit` on the host.

---

## Notes

- Default container is CPU-only and **does not require any GPU
  configuration on the host**. CI runners and laptops without an NVIDIA
  card will run this fine.
- Building from source (whisper.cpp upstream) takes time on the first
  build. Subsequent builds are cached unless `dockerfile`, `entrypoint.sh`,
  or `WHISPER_REF` change.
- Pin a whisper.cpp release with `--build-arg WHISPER_REF=v1.7.4` for
  reproducibility.
- The CUDA whisper-server binary needs CUDA runtime libraries at execution
  time. Those are provided by the `nvidia/cuda:*-runtime` base in the
  `gpu-runtime` stage. Do not try to copy `whisper-server-cuda` into a
  plain-ubuntu runtime image — it will fail with missing libcudart.so.
- This Phase A change touches only `components/...`. The actively-running
  voice-stt in `haystack-stack/docker-compose.yml` uses a different
  prebuilt image and is intentionally not modified by this work.
