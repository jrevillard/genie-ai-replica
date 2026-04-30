#!/usr/bin/env bash
# ============================================
# AMINA — One-Command Start (Linux / macOS)
# ============================================
# UNICC evaluators:
#   ./start.sh
#   open http://localhost:5174
#
# Team developers (real keys):
#   cp haystack-stack/.env.example haystack-stack/.env
#   # fill in real keys
#   ./start.sh
# ============================================

set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

SKIP_FRONTEND=0
REBUILD=0
STOP=0
for arg in "$@"; do
    case "$arg" in
        --skip-frontend|-SkipFrontend) SKIP_FRONTEND=1 ;;
        --rebuild|-Rebuild)            REBUILD=1 ;;
        --stop|-Stop)                  STOP=1 ;;
    esac
done

echo ""
echo "========================================"
echo "  AMINA - NCD Healthcare AI for Gambia"
echo "  Starting all services..."
echo "========================================"
echo ""

# build_compose_args [include_demo]
#   include_demo=1  -> layer docker-compose.demo.yml (DEMO_MODE=true)
#   include_demo=0  -> skip demo overlay (team mode)
#   default         -> layer demo overlay (used by --stop where the
#                      original startup mode is unknown; demo overlay
#                      adds no services so Stop-time inclusion is safe)
build_compose_args() {
    local include_demo="${1:-1}"
    local args=( -f docker-compose.yml )
    [ "$include_demo" = "1" ]               && args+=( -f docker-compose.demo.yml )
    [ -f docker-compose.override.yml ]      && args+=( -f docker-compose.override.yml )
    [ -f docker-compose.meta-channels.yml ] && args+=( -f docker-compose.meta-channels.yml )
    echo "${args[@]}"
}

# ── Stop mode ──────────────────────────────────────────────────────
if [ "$STOP" -eq 1 ]; then
    echo "[STOP] Shutting down all services..."
    cd "$REPO_ROOT/haystack-stack"
    # shellcheck disable=SC2046
    docker compose $(build_compose_args) down 2>&1
    cd "$REPO_ROOT"
    if [ -f components/multichannel-access/docker-compose.yml ]; then
        cd components/multichannel-access && docker compose down 2>&1 && cd "$REPO_ROOT"
    fi
    echo "[DONE] All services stopped."
    exit 0
fi

# ── 1. Docker check ────────────────────────────────────────────────
echo "[1/6] Checking Docker..."
if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is not running."
    echo "        Please start Docker (or Docker Desktop) and re-run ./start.sh"
    exit 1
fi
echo "       Docker is running."

# ── 2. AI model bootstrap ──────────────────────────────────────────
# Whisper + Piper model files are gitignored; download on first run
# so voice-stt / voice-tts can boot. Idempotent on re-runs.
echo "[2/7] Checking AI model files..."
set +e
"$REPO_ROOT/scripts/bootstrap_models.sh"
BOOTSTRAP_RC=$?
set -e
if [ "$BOOTSTRAP_RC" -ne 0 ]; then
    echo "[WARN] Model bootstrap returned $BOOTSTRAP_RC."
    echo "       Voice STT/TTS will be unhealthy. Text chat is unaffected."
    echo "       Retry: ./scripts/bootstrap_models.sh"
fi

# ── 3. Environment resolution ──────────────────────────────────────
echo "[3/7] Resolving environment..."
ENV_FILE="$REPO_ROOT/haystack-stack/.env"
ENV_DEFAULTS="$REPO_ROOT/haystack-stack/.env.defaults"

if [ ! -f "$ENV_DEFAULTS" ]; then
    echo "[ERROR] haystack-stack/.env.defaults is missing."
    echo "        This file ships with the repo. Re-clone or restore it."
    exit 1
fi

DEMO_MODE=0
if [ -f "$ENV_FILE" ]; then
    echo "       Found haystack-stack/.env (team mode)."
else
    echo "       No haystack-stack/.env found."
    echo "       Bootstrapping from .env.defaults (demo mode)..."
    cp "$ENV_DEFAULTS" "$ENV_FILE"
    echo "       Wrote haystack-stack/.env (gitignored)."
    DEMO_MODE=1
fi

# ── 3. Backend services up ─────────────────────────────────────────
echo "[4/7] Starting backend services..."
cd "$REPO_ROOT/haystack-stack"
# Demo overlay is layered ONLY when we just bootstrapped from
# .env.defaults. A team developer with a real .env keeps DEMO_MODE
# off so their code paths stay production-shaped.
COMPOSE_ARGS=$(build_compose_args "$DEMO_MODE")
if [ "$DEMO_MODE" -eq 1 ]; then
    echo "       Layering docker-compose.demo.yml (demo overlay)"
else
    echo "       Skipping demo overlay (custom .env present)"
fi

if [ "$REBUILD" -eq 1 ]; then
    echo "       --rebuild: rebuilding haystack-chatqna without cache..."
    # shellcheck disable=SC2086
    docker compose $COMPOSE_ARGS build --no-cache haystack-chatqna 2>&1
fi

# shellcheck disable=SC2086
docker compose $COMPOSE_ARGS up -d 2>&1
cd "$REPO_ROOT"
echo "       Backend containers launched."

# ── 4. Wait for backend health ─────────────────────────────────────
echo "[5/7] Waiting for backend to report healthy..."
MAX_WAIT=180
WAITED=0
HEALTHY=0
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
    sleep 5
    WAITED=$((WAITED + 5))
    if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
        HEALTHY=1
        break
    fi
    PCT=$((WAITED * 100 / MAX_WAIT))
    printf "       Still waiting... (%3ds / %3ds) [%d%%]\n" "$WAITED" "$MAX_WAIT" "$PCT"
done

if [ "$HEALTHY" -eq 1 ]; then
    echo "       Backend is healthy."
else
    echo "       Backend not healthy after ${MAX_WAIT}s."
    echo "       It may still be loading. Tail logs with:"
    echo "         docker logs --tail 60 -f haystack-chatqna"
fi

# ── 5. Frontend ────────────────────────────────────────────────────
FRONTEND_PORT=5174
if [ "$SKIP_FRONTEND" -eq 1 ]; then
    echo "[6/7] Frontend skipped (--skip-frontend)."
else
    echo "[6/7] Starting frontend..."
    if [ ! -d components/frontend ]; then
        echo "       components/frontend not found - skipping frontend."
    else
        if [ ! -d components/frontend/node_modules ]; then
            echo "       First-run: installing frontend dependencies (this takes a minute)..."
            ( cd components/frontend && npm install --silent ) || \
                echo "[WARN] npm install failed - check the frontend manually."
        fi
        ( cd components/frontend && nohup npm run dev > "$REPO_ROOT/.frontend.log" 2>&1 & )
        sleep 2
        echo "       Frontend launching at http://localhost:$FRONTEND_PORT (log: .frontend.log)"
    fi
fi

# ── 6. Summary ─────────────────────────────────────────────────────
echo ""
echo "[7/7] AMINA is ready."
echo ""
echo "========================================"
echo "  AMINA Services"
echo "========================================"
echo ""
echo "  Chat UI:        http://localhost:$FRONTEND_PORT"
echo "  Backend API:    http://localhost:8000"
echo "  Health check:   http://localhost:8000/health"
echo "  ArcadeDB:       http://localhost:2480"

# Voice service health (best-effort; non-fatal)
STT_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8087/ 2>/dev/null || echo "")
TTS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:5500/health 2>/dev/null || echo "")
if [ "$STT_CODE" = "200" ] || [ "$STT_CODE" = "404" ]; then
    echo "  Voice STT:      http://localhost:8087  [OK]"
else
    echo "  Voice STT:      http://localhost:8087  [NOT READY — model may still be downloading]"
fi
if [ "$TTS_CODE" = "200" ]; then
    echo "  Voice TTS:      http://localhost:5500  [OK]"
else
    echo "  Voice TTS:      http://localhost:5500  [NOT READY — model may still be downloading]"
fi
echo ""
if [ "$DEMO_MODE" -eq 1 ]; then
    echo "  MODE: Demo (using .env.defaults values)"
    echo "  NOTE: External providers (OpenAI, Twilio, DHIS2, Meta) are"
    echo "        disabled. Local fallback chain is exercised."
    echo "        For real keys, edit haystack-stack/.env and re-run."
else
    echo "  MODE: Team (using haystack-stack/.env)"
fi
echo ""
echo "  Stop:    ./start.sh --stop"
echo "  Rebuild: ./start.sh --rebuild"
echo "  Logs:    docker logs --tail 60 -f haystack-chatqna"
echo ""
echo "========================================"
