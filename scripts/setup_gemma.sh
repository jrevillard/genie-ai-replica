#!/usr/bin/env bash
#
# setup_gemma.sh — one-shot bring-up of TranslateGemma on the Amina A40 box.
#
# What it does (idempotent — safe to re-run):
#   1. Checks prereqs (nvidia-smi, python, huggingface-cli, cloudflared)
#   2. Logs into Hugging Face with $HF_TOKEN
#   3. Downloads google/gemma-3-4b-it to /root/models/gemma-3-4b-it
#      (~8 GB, skipped if already present)
#   4. Stops the current Amina LoRA vLLM, restarts it at gpu_mem=0.55
#      (frees ~20 GB on the 46 GB A40)
#   5. Starts the Gemma vLLM on port 9031 at gpu_mem=0.35 (~16 GB)
#   6. Waits for both /v1/models endpoints to answer 200
#   7. Starts a Cloudflare Quick Tunnel fronting port 9031
#   8. Prints the public URL you paste into the local Amina .env
#
# All logs:
#   /var/log/amina-vllm.log       (Amina LoRA, port 8100)
#   /var/log/gemma-vllm.log       (Gemma TranslateGemma, port 9031)
#   /var/log/gemma-tunnel.log     (Cloudflare tunnel stdout)
#
# Usage:
#   export HF_TOKEN=hf_xxxxx        # from huggingface.co/settings/tokens
#   ./setup_gemma.sh                # bring everything up
#   ./setup_gemma.sh --status       # show current state, don't change anything
#   ./setup_gemma.sh --stop-gemma   # stop Gemma + tunnel (leaves Amina running)

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
MODEL_ID="google/gemma-3-4b-it"
MODEL_DIR="/root/models/gemma-3-4b-it"
GEMMA_PORT=9031
GEMMA_GPU_UTIL=0.35
GEMMA_MAX_LEN=8192
GEMMA_LOG="/var/log/gemma-vllm.log"
TUNNEL_LOG="/var/log/gemma-tunnel.log"

AMINA_PORT=8100
AMINA_GPU_UTIL=0.55
AMINA_WORKDIR="/root/amina-training/training"
AMINA_MODEL_ARG="models/amina-v2-final"
AMINA_MAX_LEN=10240
AMINA_LOG="/var/log/amina-vllm.log"

PIDFILE_GEMMA="/var/run/gemma-vllm.pid"
PIDFILE_TUNNEL="/var/run/gemma-tunnel.pid"
PIDFILE_AMINA="/var/run/amina-vllm.pid"

# ── Helpers ────────────────────────────────────────────────────────────────
say()  { printf "\n\033[1;36m[%s]\033[0m %s\n" "$(date +%H:%M:%S)" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }

# Port listener probe — returns 0 if something is serving HTTP on that port.
probe_http() {
  local port="$1"
  curl -fsS --max-time 2 "http://localhost:${port}/v1/models" >/dev/null 2>&1
}

# Wait for /v1/models to respond (up to 180s)
wait_for_models() {
  local port="$1" name="$2" tries=90
  while (( tries-- > 0 )); do
    if probe_http "$port"; then
      ok "${name} on :${port} is answering /v1/models"
      return 0
    fi
    sleep 2
  done
  fail "${name} on :${port} never came up. Tail the log: ${3:-/var/log/${name}.log}"
}

# Find the current Amina vLLM api_server PID (if any).
amina_pid() {
  ps -eo pid,cmd --no-headers 2>/dev/null \
    | awk '/vllm\.entrypoints\.openai\.api_server/ && /amina-v2-final/ && !/awk/ { print $1; exit }'
}

gemma_pid() {
  if [[ -f "$PIDFILE_GEMMA" ]]; then cat "$PIDFILE_GEMMA"; return; fi
  ps -eo pid,cmd --no-headers 2>/dev/null \
    | awk -v port="$GEMMA_PORT" '/vllm\.entrypoints\.openai\.api_server/ && $0 ~ ("--port "port) && !/awk/ { print $1; exit }'
}

tunnel_pid() {
  if [[ -f "$PIDFILE_TUNNEL" ]]; then cat "$PIDFILE_TUNNEL"; return; fi
  ps -eo pid,cmd --no-headers 2>/dev/null \
    | awk -v port="$GEMMA_PORT" '/cloudflared.*tunnel/ && $0 ~ ("localhost:"port) && !/awk/ { print $1; exit }'
}

# ── Subcommands ────────────────────────────────────────────────────────────
show_status() {
  say "Status"
  local a g t gpu
  a=$(amina_pid || true)
  g=$(gemma_pid || true)
  t=$(tunnel_pid || true)
  [[ -n "$a" ]] && ok "Amina LoRA running (pid $a) on :${AMINA_PORT}" || warn "Amina LoRA NOT running on :${AMINA_PORT}"
  [[ -n "$g" ]] && ok "Gemma    running (pid $g) on :${GEMMA_PORT}" || warn "Gemma NOT running on :${GEMMA_PORT}"
  [[ -n "$t" ]] && ok "Cloudflare tunnel running (pid $t)"          || warn "Cloudflare tunnel NOT running"
  gpu=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  ok "GPU memory: ${gpu} MiB"
}

stop_gemma() {
  say "Stopping Gemma + tunnel (Amina stays up)"
  local t g
  t=$(tunnel_pid || true); if [[ -n "$t" ]]; then kill "$t" 2>/dev/null && ok "killed tunnel pid $t"; rm -f "$PIDFILE_TUNNEL"; fi
  g=$(gemma_pid  || true); if [[ -n "$g" ]]; then kill "$g" 2>/dev/null && ok "killed gemma pid $g";  rm -f "$PIDFILE_GEMMA";  fi
  sleep 2
  ok "done"
}

# ── Bring-up ───────────────────────────────────────────────────────────────

check_prereqs() {
  say "Checking prereqs"
  command -v nvidia-smi >/dev/null || fail "nvidia-smi not found — is this the A40 box?"
  command -v python3 >/dev/null    || fail "python3 missing"
  python3 -c "import vllm" >/dev/null 2>&1 || fail "vLLM not installed in the system Python. Install with: pip install vllm"
  command -v huggingface-cli >/dev/null || fail "huggingface-cli missing. Install with: pip install -U 'huggingface_hub[cli]'"
  if ! command -v cloudflared >/dev/null; then
    warn "cloudflared not found — installing..."
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
      -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
    ok "cloudflared installed"
  fi
  ok "all tools available"
}

hf_auth() {
  say "Hugging Face auth"
  if [[ -z "${HF_TOKEN:-}" ]]; then
    # Try cached token
    if [[ -f "$HOME/.cache/huggingface/token" ]] && [[ -s "$HOME/.cache/huggingface/token" ]]; then
      ok "using cached HF token at ~/.cache/huggingface/token"
      return
    fi
    fail "HF_TOKEN env var not set and no cached token. Run: export HF_TOKEN=hf_xxxxx"
  fi
  echo -n "$HF_TOKEN" | huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential=False >/dev/null 2>&1 \
    || huggingface-cli login --token "$HF_TOKEN" >/dev/null 2>&1 \
    || true
  ok "HF token accepted"
}

download_gemma() {
  say "Downloading $MODEL_ID → $MODEL_DIR (skipped if complete)"
  mkdir -p "$MODEL_DIR"
  # If the 'config.json' + at least one shard are present, assume complete
  if [[ -f "$MODEL_DIR/config.json" ]] \
     && ls "$MODEL_DIR"/model*.safetensors >/dev/null 2>&1; then
    ok "already downloaded"
    return
  fi
  huggingface-cli download "$MODEL_ID" \
    --local-dir "$MODEL_DIR" \
    --local-dir-use-symlinks False \
    --resume-download \
    2>&1 | tail -20
  [[ -f "$MODEL_DIR/config.json" ]] || fail "download did not produce config.json — license not accepted?"
  ok "download complete: $(du -sh "$MODEL_DIR" | awk '{print $1}')"
}

restart_amina() {
  say "Restarting Amina LoRA at gpu_mem=${AMINA_GPU_UTIL} (frees ~20 GB)"
  local cur
  cur=$(amina_pid || true)
  if [[ -n "$cur" ]]; then
    kill "$cur" 2>/dev/null || true
    # Wait for it to exit
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$cur" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$cur" 2>/dev/null || true
    ok "stopped old Amina vLLM (pid $cur)"
  else
    warn "no existing Amina vLLM process detected — starting fresh"
  fi

  # Start with lower memory util
  cd "$AMINA_WORKDIR"
  nohup python3 -m vllm.entrypoints.openai.api_server \
    --model "$AMINA_MODEL_ARG" \
    --host 0.0.0.0 \
    --port "$AMINA_PORT" \
    --max-model-len "$AMINA_MAX_LEN" \
    --dtype float16 \
    --gpu-memory-utilization "$AMINA_GPU_UTIL" \
    > "$AMINA_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDFILE_AMINA"
  ok "started Amina vLLM (pid $pid) — log: $AMINA_LOG"
  wait_for_models "$AMINA_PORT" "amina-vllm" "$AMINA_LOG"
}

start_gemma() {
  say "Starting Gemma vLLM on :${GEMMA_PORT} at gpu_mem=${GEMMA_GPU_UTIL}"
  local cur
  cur=$(gemma_pid || true)
  if [[ -n "$cur" ]] && kill -0 "$cur" 2>/dev/null; then
    if probe_http "$GEMMA_PORT"; then
      ok "already running (pid $cur)"
      return
    fi
    warn "stale Gemma process — restarting"
    kill "$cur" 2>/dev/null || true
    sleep 2
  fi

  nohup python3 -m vllm.entrypoints.openai.api_server \
    --model "$MODEL_DIR" \
    --served-model-name "$MODEL_ID" \
    --host 0.0.0.0 \
    --port "$GEMMA_PORT" \
    --max-model-len "$GEMMA_MAX_LEN" \
    --dtype auto \
    --gpu-memory-utilization "$GEMMA_GPU_UTIL" \
    > "$GEMMA_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDFILE_GEMMA"
  ok "started Gemma vLLM (pid $pid) — log: $GEMMA_LOG"
  wait_for_models "$GEMMA_PORT" "gemma-vllm" "$GEMMA_LOG"

  # Sanity: make sure it responds to an actual completion
  local test
  test=$(curl -fsS --max-time 30 "http://localhost:${GEMMA_PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Translate to Mandinka: Hello\"}],\"max_tokens\":40}" \
    2>/dev/null | head -c 400) || warn "inference smoke-test failed"
  [[ -n "$test" ]] && ok "smoke test: $(echo "$test" | tr -d '\n' | cut -c1-120)…"
}

start_tunnel() {
  say "Starting Cloudflare Quick Tunnel on :${GEMMA_PORT}"
  local cur
  cur=$(tunnel_pid || true)
  if [[ -n "$cur" ]] && kill -0 "$cur" 2>/dev/null; then
    warn "tunnel already running (pid $cur) — reusing; URL at bottom of $TUNNEL_LOG"
  else
    # Truncate old log so URL grep doesn't hit a stale run
    : > "$TUNNEL_LOG"
    nohup cloudflared tunnel --no-autoupdate --url "http://localhost:${GEMMA_PORT}" \
      > "$TUNNEL_LOG" 2>&1 &
    local pid=$!
    echo "$pid" > "$PIDFILE_TUNNEL"
    ok "started tunnel (pid $pid)"
  fi

  # Extract the public URL — cloudflared prints something like:
  #   2025-... INF |  https://random-words.trycloudflare.com  |
  say "Waiting for tunnel URL (up to 60s)"
  local url="" tries=30
  while (( tries-- > 0 )); do
    url=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
    [[ -n "$url" ]] && break
    sleep 2
  done
  [[ -z "$url" ]] && fail "tunnel URL not found — tail $TUNNEL_LOG"

  echo
  echo "============================================================"
  echo "  TUNNEL READY"
  echo "============================================================"
  echo "  Public URL : $url"
  echo "  Paste this into Amina's local haystack-stack/.env:"
  echo
  echo "      USE_GEMMA_TRANSLATOR=true"
  echo "      GEMMA_BASE_URL=${url}/v1"
  echo "      GEMMA_MODEL=${MODEL_ID}"
  echo "      GEMMA_API_KEY=not-needed"
  echo
  echo "  Then on your Windows box:"
  echo "      docker compose restart haystack-chatqna"
  echo "============================================================"
}

# ── Main ───────────────────────────────────────────────────────────────────
case "${1:-up}" in
  --status|status) show_status; exit 0 ;;
  --stop-gemma)    stop_gemma;  exit 0 ;;
  up|"")
    check_prereqs
    hf_auth
    download_gemma
    restart_amina
    start_gemma
    start_tunnel
    echo
    show_status
    ;;
  *) fail "unknown arg: $1" ;;
esac
