#!/bin/sh
# voice-stt entrypoint -- GPU-first / CPU-fallback STT backend chooser.
#
# Reads STT_BACKEND and tries to run whisper.cpp's HTTP server using the
# requested backend, with safe fallback semantics. Logs the decision so
# operators can verify which binary is active.
#
# Environment variables:
#   STT_BACKEND        auto | cpu | cuda | vulkan        default: auto
#   STT_ALLOW_FALLBACK true | false                       default: false
#   WHISPER_MODEL      path to ggml/gguf model            default: /models/ggml-small.en.bin
#   WHISPER_PORT       listen port                        default: 8080
#   WHISPER_THREADS    threads (CPU mode primarily)       default: 4
#   WHISPER_GPU_DEVICE CUDA device index                  default: 0
#   WHISPER_EXTRA_ARGS extra args appended to whisper-server (advanced)
#
# Backend selection logic:
#   STT_BACKEND=cpu     -> always run CPU binary (never falls back).
#   STT_BACKEND=cuda    -> run CUDA binary IF the binary exists AND nvidia-smi
#                          succeeds. Otherwise:
#                            - STT_ALLOW_FALLBACK=true -> fall back to CPU
#                            - STT_ALLOW_FALLBACK=false (default) -> fail with
#                              clear log + non-zero exit so the orchestrator
#                              can detect misconfiguration.
#   STT_BACKEND=vulkan  -> same pattern as cuda (Vulkan binary not built today
#                          but the slot is reserved -- entrypoint will use it
#                          if a future Dockerfile target ships one).
#   STT_BACKEND=auto    -> prefer cuda when available + working, else cpu.
#                          Always falls back to CPU on detection failure --
#                          never blocks startup on a non-GPU host.
#
# This script intentionally writes no markup-style logs. It uses one-line
# key=value tags so log aggregators can grep for `backend=` reliably.

set -eu

STT_BACKEND="${STT_BACKEND:-auto}"
STT_ALLOW_FALLBACK="${STT_ALLOW_FALLBACK:-false}"
WHISPER_MODEL="${WHISPER_MODEL:-/models/ggml-small.en.bin}"
WHISPER_PORT="${WHISPER_PORT:-8080}"
WHISPER_THREADS="${WHISPER_THREADS:-4}"
WHISPER_GPU_DEVICE="${WHISPER_GPU_DEVICE:-0}"
WHISPER_EXTRA_ARGS="${WHISPER_EXTRA_ARGS:-}"

CPU_BIN="/usr/local/bin/whisper-server-cpu"
CUDA_BIN="/usr/local/bin/whisper-server-cuda"
VULKAN_BIN="/usr/local/bin/whisper-server-vulkan"

log()  { printf '[voice-stt-entrypoint] %s\n' "$*" >&2; }

# ─── runtime GPU detection ───────────────────────────────────────────
gpu_available_cuda() {
    # 1. nvidia-smi present + executable
    if ! command -v nvidia-smi >/dev/null 2>&1; then
        return 1
    fi
    # 2. nvidia-smi can list at least one GPU
    if ! nvidia-smi -L >/dev/null 2>&1; then
        return 1
    fi
    return 0
}

cuda_bin_present() { [ -x "$CUDA_BIN" ]; }
vulkan_bin_present() { [ -x "$VULKAN_BIN" ]; }
cpu_bin_present() { [ -x "$CPU_BIN" ]; }

# ─── pick a backend (echoes "cpu", "cuda", or "vulkan") ──────────────
choose_backend() {
    case "$STT_BACKEND" in
        cpu)
            log "decision backend=cpu reason=forced (STT_BACKEND=cpu)"
            echo "cpu"
            return
            ;;
        cuda)
            if cuda_bin_present && gpu_available_cuda; then
                log "decision backend=cuda reason=forced+available device=$WHISPER_GPU_DEVICE"
                echo "cuda"
                return
            fi
            log "STT_BACKEND=cuda requested but unavailable:"
            log "  cuda_binary_present=$(cuda_bin_present && echo yes || echo no)"
            log "  nvidia-smi-works=$(gpu_available_cuda && echo yes || echo no)"
            if [ "$STT_ALLOW_FALLBACK" = "true" ]; then
                log "decision backend=cpu reason=cuda_unavailable+fallback_allowed"
                echo "cpu"
                return
            fi
            log "FATAL: STT_BACKEND=cuda but cuda is not usable AND STT_ALLOW_FALLBACK!=true"
            log "       set STT_ALLOW_FALLBACK=true to permit auto fallback to CPU,"
            log "       or use STT_BACKEND=auto for graceful default."
            exit 2
            ;;
        vulkan)
            if vulkan_bin_present; then
                log "decision backend=vulkan reason=forced+binary_present"
                echo "vulkan"
                return
            fi
            log "STT_BACKEND=vulkan requested but vulkan binary is not in this image."
            log "  expected: $VULKAN_BIN (image was not built with vulkan target)"
            if [ "$STT_ALLOW_FALLBACK" = "true" ]; then
                log "decision backend=cpu reason=vulkan_unavailable+fallback_allowed"
                echo "cpu"
                return
            fi
            log "FATAL: STT_BACKEND=vulkan but vulkan is not usable AND STT_ALLOW_FALLBACK!=true"
            exit 2
            ;;
        auto)
            if cuda_bin_present && gpu_available_cuda; then
                log "decision backend=cuda reason=auto+gpu_detected device=$WHISPER_GPU_DEVICE"
                echo "cuda"
                return
            fi
            # Build a structured reason string so it greps nicely.
            reasons=""
            cuda_bin_present || reasons="${reasons}cuda_binary_missing(image_built_cpu_only) "
            gpu_available_cuda || reasons="${reasons}nvidia-smi_unavailable_or_no_gpu "
            log "decision backend=cpu reason=auto+fallback_to_cpu (${reasons% })"
            echo "cpu"
            return
            ;;
        *)
            log "FATAL: unknown STT_BACKEND='$STT_BACKEND' (expected: auto|cpu|cuda|vulkan)"
            exit 2
            ;;
    esac
}

backend="$(choose_backend)"

case "$backend" in
    cpu)
        if ! cpu_bin_present; then
            log "FATAL: CPU binary missing at $CPU_BIN -- image build is broken"
            exit 3
        fi
        bin="$CPU_BIN"
        ;;
    cuda)
        bin="$CUDA_BIN"
        # Restrict CUDA visibility to the requested device.
        export CUDA_VISIBLE_DEVICES="$WHISPER_GPU_DEVICE"
        ;;
    vulkan)
        bin="$VULKAN_BIN"
        ;;
esac

if [ ! -e "$WHISPER_MODEL" ]; then
    log "WARN: model file not found at WHISPER_MODEL=$WHISPER_MODEL"
    log "      whisper-server will likely fail to load. Mount your .bin/.gguf at"
    log "      /models/ and set WHISPER_MODEL accordingly."
fi

log "starting whisper-server backend=$backend bin=$bin model=$WHISPER_MODEL port=$WHISPER_PORT threads=$WHISPER_THREADS"

# shellcheck disable=SC2086 -- WHISPER_EXTRA_ARGS is intentionally word-split
exec "$bin" \
    -m "$WHISPER_MODEL" \
    --host 0.0.0.0 \
    --port "$WHISPER_PORT" \
    --threads "$WHISPER_THREADS" \
    $WHISPER_EXTRA_ARGS
