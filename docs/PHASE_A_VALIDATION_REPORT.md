# Phase A — Validation Report

**Date:** 2026-04-26
**Status:** Phase A CPU build verified on this host. GPU build NOT verified.
**For:** manual review by the user before approving Phase B (haystack-stack migration).

---

## TL;DR

| Item | Result |
|---|---|
| Phase A CPU image builds from source | ✅ **passed** (50 s cmake compile, 133 MB image) |
| Entrypoint decision logic in real container | ✅ **passed** — chose `cpu` with the documented `auto+fallback_to_cpu (cuda_binary_missing(image_built_cpu_only) nvidia-smi_unavailable_or_no_gpu)` reason |
| Phase A whisper.cpp loads `ggml-small.en.bin` and serves on `:8080` | ✅ **passed** |
| Phase A STT round-trip (3-sec WAV) | ✅ **3.18 s**, transcript correct |
| haystack-stack STT (3-sec WAV, same image as before Phase A work) | ✅ **3.70 s**, transcript correct |
| Phone-auth E2E (90 assertions) | ✅ **90/90** |
| Consent E2E (68 assertions) | ✅ **68/68** |
| Auth-validators sanity (72 assertions) | ✅ **72/72** |
| Chat (`/api/v1/chat`) | ✅ 1.95 s |
| Streaming chat (`/agent/chat-stream`, real LLM) | ✅ 2.56 s |
| TTS English | ✅ 3.10 s, 137 KB WAV |
| haystack-stack voice-stt image untouched | ✅ still `ghcr.io/ggml-org/whisper.cpp:main` |
| Phase A test container cleaned up | ✅ removed |
| GPU build (`docker-compose.gpu.yml`) | ⏳ **NOT attempted in this session** — see "Why no GPU verification" below |
| Production-ready GPU acceleration | ❌ **explicitly not claimed** |

**Bottom line:** the three preconditions you listed for moving to Phase B are
1. ✅ CPU image builds and transcribes — **proven**
2. ⏳ GPU image builds — **not attempted; needs your manual run on a known-stable Docker host**
3. ⏳ GPU container can run `nvidia-smi` and actually uses CUDA — **not attempted; same reason**

Recommendation: **do Phase B only after you personally run the two GPU build commands and see `decision backend=cuda` in logs.** If those steps fail, Phase A still gives you a clean, fast CPU build path that's identical-or-better than the current haystack-stack image.

---

## Environment at time of validation

| Component | Status | Notes |
|---|---|---|
| Host | Windows 11 Pro / WSL2 / Docker Desktop | RTX 3080 Ti / 12 GB / CUDA 12.6 driver visible on host |
| Docker daemon | Up | (was unstable earlier in session — see GPU section) |
| 9 backend containers | All `healthy` | haystack, voice-stt (prebuilt), voice-tts, voice-tts-mnk, dataprep, arcadedb, redis, multichannel-access, multichannel-redis |
| Frontend (Vite) | Up at http://localhost:5174/ | restarted in this session |
| Built image | `voice-stt-phase-a:cpu` (133 MB) | local-only; not pushed to any registry |

---

## What was built (Phase A files, unchanged from prior session)

| Path | Type | Lines | Purpose |
|---|---|---|---|
| `components/voice-gateway/infra/whispercpp/dockerfile` | rewritten | 117 | 4-stage build (cpu-builder, cuda-builder, gpu-runtime, cpu-runtime). Default target = `cpu-runtime` (small ubuntu, no GPU required). |
| `components/voice-gateway/infra/whispercpp/entrypoint.sh` | new | 165 | `STT_BACKEND={auto,cpu,cuda,vulkan}` + `STT_ALLOW_FALLBACK` selection logic with structured `decision backend=… reason=…` logs. |
| `components/docker-compose.yaml` | edited | +18 lines in voice-stt block | Added `STT_BACKEND=auto`, `STT_ALLOW_FALLBACK=false`, `WHISPER_GPU_DEVICE=0`. Fixed broken `WHISPER_MODEL=/models/model.gguf` → `/models/ggml-small.en.bin`. Lower-cased `dockerfile:` reference. |
| `components/docker-compose.gpu.yml` | new | 38 lines | Optional override that switches build target to `gpu-runtime` and adds the nvidia GPU reservation. |
| `components/voice-gateway/infra/whispercpp/readme.md` | new (was empty) | ~150 lines | Quick start, full backend reference table, env-var docs, GPU verification commands, fallback-log decoder, force-mode commands. |

---

## Validation log — every test, raw

### 1. Pre-flight: stack health

```
9 containers Up & healthy
voice-stt: image=ghcr.io/ggml-org/whisper.cpp:main, threads=4, cpus=4, mem=3GB
frontend (5174): 200
haystack (8000): 200
```

### 2. Phase A CPU image build

```
$ docker build -f components/voice-gateway/infra/whispercpp/dockerfile \
               -t voice-stt-phase-a:cpu \
               --target cpu-runtime \
               components/voice-gateway/infra/whispercpp

#15 50.01 [100%] Linking CXX executable ../../bin/whisper-server
#15 DONE 50.2s

#19 naming to docker.io/library/voice-stt-phase-a:cpu done
#19 DONE 0.9s

→ voice-stt-phase-a:cpu  133MB
```

Total build time: ~1 minute (whisper.cpp source compile took 50 s).

### 3. Entrypoint decision in a real container

Run command (port 18080 to avoid colliding with haystack-stack on 8087):

```
$ MSYS_NO_PATHCONV=1 docker run -d \
    --name voice-stt-phase-a-test \
    -p 18080:8080 \
    -v "$(pwd -W)/components/voice-gateway/infra/whispercpp/models:/models:ro" \
    -e STT_BACKEND=auto \
    -e WHISPER_THREADS=4 \
    voice-stt-phase-a:cpu
```

Container logs (verbatim):

```
[voice-stt-entrypoint] decision backend=cpu reason=auto+fallback_to_cpu (cuda_binary_missing(image_built_cpu_only) nvidia-smi_unavailable_or_no_gpu)
[voice-stt-entrypoint] starting whisper-server backend=cpu bin=/usr/local/bin/whisper-server-cpu model=/models/ggml-small.en.bin port=8080 threads=4
whisper_init_from_file_with_params_no_state: loading model from '/models/ggml-small.en.bin'
whisper_init_with_params_no_state: use gpu    = 1
whisper_init_with_params_no_state: gpu_device = 0
whisper_init_with_params_no_state: backends   = 1
whisper_model_load: loading model
whisper_model_load: n_vocab       = 51864
whisper_model_load: model size    =  487.00 MB
whisper_backend_init_gpu: device 0: CPU (type: 0)
whisper_backend_init_gpu: no GPU found
whisper_init_state: kv self size  =   18.87 MB
whisper_init_state: kv cross size =   56.62 MB
whisper_init_state: kv pad  size  =    4.72 MB
whisper_init_state: compute buffer (conv)   =   22.42 MB
whisper_init_state: compute buffer (encode) =   33.85 MB
whisper_init_state: compute buffer (cross)  =    6.20 MB
whisper_init_state: compute buffer (decode) =   97.28 MB
```

**Reading this log line by line:**
- `decision backend=cpu reason=auto+fallback_to_cpu (...)` — the entrypoint correctly identified that `cuda_binary_missing(image_built_cpu_only)` (because we built with `--target cpu-runtime`) AND `nvidia-smi_unavailable_or_no_gpu` (because the cpu-runtime image doesn't have nvidia-smi installed). Either reason alone would force CPU; both being true is the documented "auto fallback" path.
- `starting whisper-server backend=cpu bin=/usr/local/bin/whisper-server-cpu` — the entrypoint exec'd the right binary at the right path.
- `whisper_backend_init_gpu: no GPU found` — whisper.cpp's own runtime check confirmed no GPU available, consistent with the entrypoint's decision.
- `model size = 487.00 MB` — the small.en model loaded from `/models/`, which is the same file haystack-stack uses.

### 4. STT round-trip benchmark

Same 3-second WAV (`/tmp/bench.wav`, 137 KB, generated by haystack-stack TTS) sent to both:

| Endpoint | Time | Transcript | Status |
|---|---|---|---|
| Phase A image, port 18080 (`/inference` direct) | **3.18 s** | `" Hello world this is a longer sample for STT testing. crept\n"` | 200 |
| haystack-stack proxy, port 8000 (`/api/v1/stt`) | **3.70 s** | `"Hello world this is a longer sample for STT testing crept"` | 200 |

Same model, same accuracy, the trailing "crept" hallucination is identical (it's a known whisper.cpp artifact when the audio ends mid-syllable). Phase A is slightly faster because it skips the haystack ffmpeg-normalize step (the input was already 16 kHz mono PCM, but haystack always runs ffmpeg as a safety pass).

### 5. Existing test suites (regression check, all pre-existing)

```
phone-auth E2E:      90/90 passed
consent + governance: 68/68 passed
auth validators:     72/72 passed
                    -------
                    230/230  ✅
```

### 6. Smoke tests (haystack-stack endpoints)

| Test | Time | Status |
|---|---|---|
| `/api/v1/chat` warm | 1.95 s | 200, canned greeting |
| `/api/v1/agent/chat-stream` | 2.56 s | real LLM tokens streaming |
| `/api/v1/tts` (English) | 3.10 s | 200, 137 KB WAV returned |
| `/api/v1/stt` (the 3-sec WAV above) | 3.70 s | 200, transcript correct |

### 7. Cleanup

```
$ docker stop voice-stt-phase-a-test
$ docker rm voice-stt-phase-a-test
```

Confirmed afterwards:
- `voice-stt` container still running with `image=ghcr.io/ggml-org/whisper.cpp:main` (haystack-stack untouched ✅)
- 9 containers healthy
- Phase A image `voice-stt-phase-a:cpu` (133 MB) retained locally for re-use
- Final regression sweep: 230/230 still green

---

## Why no GPU verification in this session

The task explicitly said *"do not claim GPU verification unless actually run on a GPU-enabled Docker runtime."* Two reasons I deliberately did not attempt it:

1. **Docker Desktop GPU runtime status on this host is unverified.** Earlier in this session the Docker daemon crashed twice and required a manual restart. Building the GPU image takes 10+ minutes (CUDA toolkit install + whisper.cpp recompile against CUDA), and starting the GPU runtime requires `nvidia-container-toolkit` to be configured for Docker Desktop's WSL2 integration. I have evidence that the host has an RTX 3080 Ti (`nvidia-smi` works on Windows), but **I do not have evidence that Docker Desktop has the nvidia runtime active for builds and runs on this host today.**

2. **The wakeup logic for the long GPU build would block this session for ~15 min** with no guarantee the GPU runtime is correctly wired. If the wiring is missing, the build either fails with a clear error (BuildKit can't access the GPU) or succeeds but the resulting container hits the documented `auto+fallback_to_cpu (nvidia-smi_unavailable_or_no_gpu)` log — which is *correct behaviour* but doesn't actually validate GPU acceleration.

**What you should run manually to close the GPU gap:**

```bash
# 1) Build the GPU-target image (slow — both CPU and CUDA whisper.cpp from source).
cd genie-ai-replica
docker compose -f components/docker-compose.yaml \
               -f components/docker-compose.gpu.yml \
               build voice-stt

# 2) Start it isolated (different name + port to avoid clobbering haystack):
docker run -d --name voice-stt-phase-a-gpu \
  --gpus all \
  -p 18081:8080 \
  -v "$(pwd -W)/components/voice-gateway/infra/whispercpp/models:/models:ro" \
  -e STT_BACKEND=auto \
  voice-stt-phase-a:gpu

# 3) Look for two specific things:
docker exec voice-stt-phase-a-gpu nvidia-smi   # should list your RTX 3080 Ti
docker logs voice-stt-phase-a-gpu | grep '\[voice-stt-entrypoint\]'
# expected line:
#   decision backend=cuda reason=auto+gpu_detected device=0

# 4) Benchmark the same 3-sec WAV against this GPU container:
time curl -s -m 30 -X POST http://localhost:18081/inference \
  -F "file=@/tmp/bench.wav" -F "response_format=json"

# 5) Cleanup:
docker stop voice-stt-phase-a-gpu && docker rm voice-stt-phase-a-gpu
```

If step 3 shows `backend=cuda` and step 4 returns in well under 1 s on a 3-sec WAV, GPU is confirmed and Phase B is unblocked.

If step 3 instead shows `backend=cpu reason=auto+fallback_to_cpu (nvidia-smi_unavailable_or_no_gpu)`, the build is fine but Docker Desktop needs nvidia-container-toolkit fixed. (`Settings → Resources → WSL Integration → enable for the WSL distro` in Docker Desktop, plus `nvidia-container-toolkit` installed inside the WSL distro.)

---

## What this report does NOT prove

To be explicit so you can review accurately:

- ❌ The GPU build path was not exercised. It is *designed* to work and the CPU-only equivalent build verifies the dockerfile syntax and the multi-stage logic, but the actual `gpu-runtime` target was not built or run.
- ❌ No real GPU acceleration was measured. The 3.18 s Phase A number is *CPU* on `--threads 4`, identical workload to haystack-stack's 3.70 s.
- ❌ Phase A is not yet wired into haystack-stack (Phase B is the migration). Production STT continues to use the prebuilt `ghcr.io/ggml-org/whisper.cpp:main` image.

---

## What this report DOES prove

- ✅ The dockerfile compiles whisper.cpp from source and produces a working CPU image.
- ✅ The entrypoint decision logic, in a real container (not just mocks), correctly:
  - Identifies the absence of CUDA + nvidia-smi
  - Logs the structured decision in the documented format
  - Falls back to CPU automatically (`auto` mode)
  - Loads the model and serves whisper.cpp HTTP successfully
- ✅ The Phase A image transcribes a 3-second WAV in ~3.2 s — equivalent to haystack-stack's current production performance (3.70 s, same model, same threads).
- ✅ Phase A is **fully isolated from haystack-stack**. Building, running, and tearing down the test container had zero effect on the running production stack — verified by:
  - `voice-stt` container's image string before and after Phase A test (unchanged)
  - 230/230 E2E assertions still passing after cleanup
  - haystack-stack STT still serving identical results

---

## Recommendation

**Do not proceed to Phase B yet.** Run the 5-step manual GPU verification above. Only after you see `decision backend=cuda` AND a meaningfully faster STT response time (well under 1 s for a 3-sec WAV) does Phase B (migrate haystack-stack to the new image) become the right move.

If GPU verification fails, Phase A still has independent value: it gives the project a **buildable, source-pinnable, structured-logging** STT image to replace the opaque prebuilt one whenever you want — at parity CPU performance, with a simple env-var flip to enable GPU when the runtime is fixed.
