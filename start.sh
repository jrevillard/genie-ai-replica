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
SKIP_VERIFY=0
BASELINE=0
REBUILD=0
STOP=0
for arg in "$@"; do
    case "$arg" in
        --skip-frontend|-SkipFrontend) SKIP_FRONTEND=1 ;;
        --rebuild|-Rebuild)            REBUILD=1 ;;
        --stop|-Stop)                  STOP=1 ;;
        --skip-verify|-SkipVerify)     SKIP_VERIFY=1 ;;
        --baseline|-Baseline)          BASELINE=1 ;;
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
    # Translation v4.2 -- NLLB sidecar overlay (optional)
    [ -f docker-compose.nllb.yml ]          && args+=( -f docker-compose.nllb.yml )
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
echo "[1/8] Checking Docker..."
if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is not running."
    echo "        Please start Docker (or Docker Desktop) and re-run ./start.sh"
    exit 1
fi
echo "       Docker is running."

# ── 2. AI model bootstrap ──────────────────────────────────────────
# Whisper + Piper model files are gitignored; download on first run
# so voice-stt / voice-tts can boot. Idempotent on re-runs.
echo "[2/8] Checking AI model files..."
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
echo "[3/8] Resolving environment..."
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
echo "[4/8] Starting backend services..."
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
echo "[5/8] Waiting for backend to report healthy..."
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

# ── 6. Translation v4.2 verify (NLLB sidecar contract + ArcadeDB schema + canary) ──
# All sub-steps are best-effort; none of them block the user.
NLLB_READY=0
NLLB_CONTRACT="unknown"
CANARY_DECISION=""
CANARY_ENGINE=""
CANARY_OUTPUT=""
V4_ENABLED_RUNTIME=1
GOLDEN_TOTAL=0
VALIDATED_COUNT=0
echo "[6/8] Verifying Translation v4.2 ..."

# Read validation progress so the summary can show "X/N validated".
GOLDEN_FILE="haystack-stack/haystack-chatqna/src/translation_v4/eval/golden_translations.json"
if [ -f "$GOLDEN_FILE" ]; then
    GOLDEN_TOTAL=$(python -c "import json; print(len(json.load(open('$GOLDEN_FILE'))['pairs']))" 2>/dev/null || echo 0)
    VALIDATED_COUNT=$(python -c "import json; print(sum(1 for p in json.load(open('$GOLDEN_FILE'))['pairs'] if p.get('validated')))" 2>/dev/null || echo 0)
fi

if [ "$SKIP_VERIFY" -eq 1 ]; then
    echo "       --skip-verify -> skipping NLLB probe + schema warm + canary."
elif [ ! -f haystack-stack/docker-compose.nllb.yml ]; then
    echo "       NLLB overlay not present; v4.2 verify skipped (running v3.5 / LLM-only)."
else
    # 6a. Wait for NLLB sidecar. The wait budget depends on whether the
    # image is already pulled:
    #   * first run  -> ~7.6 GB image pull (5-10 min on typical broadband)
    #                   plus model load inside the container (~120 s)
    #   * subsequent -> model load only (~120 s)
    if docker image ls --format "{{.Repository}}" 2>/dev/null | grep -q "nllb"; then
        NLLB_TIMEOUT=180
        IMAGE_CACHED=1
        echo "       NLLB image cached -- waiting up to 3 min for model load."
    else
        NLLB_TIMEOUT=900
        IMAGE_CACHED=0
        echo "       NLLB image not cached -- pulling ~7.6 GB Docker image (5-10 min)..."
        echo "       This only happens once. Subsequent starts are <2 min."
        echo "       Tip: pre-pull the night before with"
        echo "         docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate"
    fi
    NLLB_WAIT=0
    while [ "$NLLB_WAIT" -lt "$NLLB_TIMEOUT" ]; do
        sleep 5
        NLLB_WAIT=$((NLLB_WAIT + 5))
        CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:7860/api/v4/health 2>/dev/null || echo "")
        if [ "$CODE" != "200" ]; then
            CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:7860/health 2>/dev/null || echo "")
        fi
        if [ "$CODE" = "200" ]; then NLLB_READY=1; break; fi
        if [ $((NLLB_WAIT % 30)) -eq 0 ]; then
            printf "       still waiting for NLLB (%4ds / %ds)...\n" "$NLLB_WAIT" "$NLLB_TIMEOUT"
        fi
    done
    if [ "$NLLB_READY" -eq 1 ]; then
        echo "       NLLB sidecar healthy after ${NLLB_WAIT}s."
        # 6b. Endpoint contract probe. The prebuilt
        # ghcr.io/winstxnhdw/nllb-api image returns ``{"result": ...}``;
        # older self-built forks returned ``{"text": ...}``. Accept either.
        BODY=$(curl -s --max-time 8 "http://localhost:7860/api/v4/translator?text=hello&source=eng_Latn&target=bam_Latn" 2>/dev/null || echo "")
        if echo "$BODY" | grep -qE '"(text|result)"'; then
            NLLB_CONTRACT="ok"
            echo "       Endpoint contract /api/v4/translator -> 200 + text/result field."
        else
            NLLB_CONTRACT="unexpected_shape"
            echo "       NLLB returned 200 but body shape unexpected; check the image version."
        fi
    else
        echo "       NLLB sidecar not healthy after ${NLLB_TIMEOUT}s; v4.2 will degrade to v3.5 (LLM)."
        echo "       To check progress: docker logs nllb-translate --tail 20"
    fi
fi

if [ "$SKIP_VERIFY" -eq 0 ]; then
# 6c. Eager-bootstrap the ArcadeDB TranslationMetric schema.
# Idempotent; if it fails the first telemetry call lazy-bootstraps instead.
SCHEMA_OUT=$(docker exec haystack-chatqna python -c "import asyncio,sys; sys.path.insert(0,'/app'); from src.translation_v4.stage8_telemetry import ArcadeDBTelemetryStore; print('schema_ready=' + str(asyncio.run(ArcadeDBTelemetryStore().bootstrap_schema())))" 2>/dev/null | tail -1 || echo "")
if echo "$SCHEMA_OUT" | grep -q "schema_ready=True"; then
    echo "       ArcadeDB TranslationMetric schema ready."
else
    echo "       ArcadeDB schema warm deferred (lazy-bootstrap on first translation)."
fi

# 6d. Canary translation through the live v4 pipeline.
CANARY_PY='import asyncio, json, sys
sys.path.insert(0, "/app")
from src.translation_v4 import config as cfg
if not cfg.AMINA_TRANSLATION_V4_ENABLED:
    print(json.dumps({"v4": False, "note": "AMINA_TRANSLATION_V4_ENABLED=false"}))
    sys.exit(0)
from src.translation_v4.pipeline import get_pipeline
async def go():
    return await get_pipeline().translate(english_text="How are you?", patient_context={}, session_id="canary", response_type="general")
out = asyncio.run(go()) or {}
print(json.dumps({
    "v4": True,
    "decision": out.get("overall_decision"),
    "engines": out.get("engine_selection"),
    "nllb_invoked": out.get("nllb_invoked"),
    "bt_method": (out.get("back_translation") or {}).get("engine_used_back"),
    "overall": (out.get("quality_scores") or {}).get("overall"),
    "latency_ms": out.get("total_latency_ms"),
    "output_preview": (out.get("assembled_output") or "")[:80],
}))'
# Filter to lines that start with `{` first, then take the last one --
# without the grep, ``tail -1`` would pick up a config warning line
# (``[config] JWT_SECRET unset...``) printed before the JSON and report
# "could not parse canary response" even though the canary succeeded.
# Mirrors the same fix in start.ps1.
CANARY_RAW=$(docker exec haystack-chatqna python -c "$CANARY_PY" 2>/dev/null | grep -E '^\{' | tail -1 || echo "")
if echo "$CANARY_RAW" | grep -q '"v4": false'; then
    V4_ENABLED_RUNTIME=0
    echo "       Canary skipped: AMINA_TRANSLATION_V4_ENABLED=false in this env."
elif echo "$CANARY_RAW" | grep -q '^{'; then
    CANARY_DECISION=$(echo "$CANARY_RAW" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('decision') or '')" 2>/dev/null || echo "")
    CANARY_ENGINE=$(echo "$CANARY_RAW"   | python -c "import sys,json; d=json.load(sys.stdin); e=d.get('engines') or []; print(e[0] if e else '')" 2>/dev/null || echo "")
    CANARY_LAT=$(echo "$CANARY_RAW"      | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('latency_ms') or '')" 2>/dev/null || echo "")
    CANARY_BT=$(echo "$CANARY_RAW"       | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('bt_method') or '')" 2>/dev/null || echo "")
    CANARY_OUTPUT=$(echo "$CANARY_RAW"   | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('output_preview') or '')" 2>/dev/null || echo "")
    echo "       Canary 'How are you?' -> decision=${CANARY_DECISION} engine=${CANARY_ENGINE} bt=${CANARY_BT} latency=${CANARY_LAT}ms"
    [ -n "$CANARY_OUTPUT" ] && echo "         output: ${CANARY_OUTPUT}"
else
    echo "       Canary translation produced unexpected output; v4 may not be active."
fi
fi  # end SKIP_VERIFY guard for 6c + 6d

# 6e. Optional baseline run -- one-shot full eval. Real LLM calls;
# only triggered with --baseline.
if [ "$BASELINE" -eq 1 ]; then
    echo "       --baseline -> running scripts/translation_baseline.py ..."
    PYTHONIOENCODING=utf-8 python scripts/translation_baseline.py 2>&1 | sed 's/^/       /'
fi

# ── 7. Frontend ────────────────────────────────────────────────────
FRONTEND_PORT=5174
if [ "$SKIP_FRONTEND" -eq 1 ]; then
    echo "[7/8] Frontend skipped (--skip-frontend)."
else
    echo "[7/8] Starting frontend..."
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
echo "[8/8] AMINA is ready."
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

# Pre-pull tip: only when the NLLB image was NOT cached at [6/8] AND
# NLLB still isn't ready. Mirrors start.ps1.
if [ "${IMAGE_CACHED:-1}" -eq 0 ] && [ "${NLLB_READY:-0}" -ne 1 ]; then
    echo ""
    echo "  TIP: pre-pull NLLB for faster next start:"
    echo "       docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate"
fi

# Translation v4.2 status block
echo ""
echo "  Translation pipeline:"
if [ "$V4_ENABLED_RUNTIME" -eq 0 ]; then
    echo "    v4 path: DISABLED (AMINA_TRANSLATION_V4_ENABLED=false)"
    echo "    Active : v1 (legacy translator + corrector)"
else
    if [ "$NLLB_READY" -eq 1 ]; then
        echo "    v4 path: ACTIVE"
        echo "    NLLB   : ready (3-engine selection live: phrasebank > NLLB > LLM)"
        if [ "$NLLB_CONTRACT" != "ok" ]; then
            echo "    NOTE   : NLLB endpoint contract probe was '${NLLB_CONTRACT}'."
        fi
    else
        echo "    v4 path: ACTIVE (graceful v3.5 fallback)"
        echo "    NLLB   : not ready -> running phrasebank + LLM only"
    fi
    if [ -n "$CANARY_ENGINE" ]; then
        echo "    Canary : 'How are you?' -> ${CANARY_DECISION} via ${CANARY_ENGINE}"
    elif [ "$SKIP_VERIFY" -eq 1 ]; then
        echo "    Verify : skipped (--skip-verify)"
    fi
    if [ "$GOLDEN_TOTAL" -gt 0 ]; then
        echo "    Review : ${VALIDATED_COUNT}/${GOLDEN_TOTAL} golden pairs validated by native speaker"
        if [ "$VALIDATED_COUNT" -lt "$GOLDEN_TOTAL" ]; then
            echo "             run: python scripts/review_translations.py"
        fi
    fi
    echo "    Baseline: python scripts/translation_baseline.py    (writes docs/compliance/translation_v4_baseline_<date>.json)"
fi

echo ""
echo "  Stop:    ./start.sh --stop"
echo "  Rebuild: ./start.sh --rebuild"
echo "  Logs:    docker logs --tail 60 -f haystack-chatqna"
echo ""
echo "========================================"
