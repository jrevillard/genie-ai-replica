#!/usr/bin/env bash
# ============================================
# AMINA Model Bootstrapper (Linux / macOS)
# ============================================
# Mirror of scripts/bootstrap_models.ps1. Called automatically by
# start.sh on first run; re-running is idempotent.
#
# Manual use:
#   ./scripts/bootstrap_models.sh
#   ./scripts/bootstrap_models.sh --force
#
# Paths below match haystack-stack/docker-compose.yml exactly:
#   voice-stt:    ../components/voice-gateway/infra/whispercpp/models:/models:ro
#                 command: ... -m /models/ggml-base.en.bin
#   voice-tts:    ../components/voice-gateway/infra/piper/models:/models/piper:ro
#                 PIPER_MODEL_PATH=/models/piper/en_US-lessac-medium.onnx
# ============================================

set -e
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "[MODELS] Checking required AI models..."

# Each entry: <name>|<url>|<rel-path>|<expected-size-label>
MODELS=(
  "Whisper STT (base.en)|https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin|components/voice-gateway/infra/whispercpp/models/ggml-base.en.bin|148 MB"
  "Piper TTS voice (en_US-lessac-medium)|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx|components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx|63 MB"
  "Piper TTS config (en_US-lessac-medium)|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json|components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx.json|5 KB"
)

DOWNLOADED=0
SKIPPED=0
FAILURES=()

for entry in "${MODELS[@]}"; do
    NAME="${entry%%|*}"
    rest="${entry#*|}"
    URL="${rest%%|*}"
    rest="${rest#*|}"
    REL="${rest%%|*}"
    SIZE_LABEL="${rest##*|}"

    FULL="$REPO_ROOT/$REL"

    if [ -f "$FULL" ] && [ "$FORCE" -ne 1 ]; then
        SZ=$(wc -c < "$FULL" 2>/dev/null | tr -d ' ' || echo 0)
        if [ "$SZ" -gt 1024 ]; then
            MB=$(awk "BEGIN {printf \"%.1f\", $SZ / 1048576}")
            printf "  [OK]       %-45s  %7s MB (already present)\n" "$NAME" "$MB"
            SKIPPED=$((SKIPPED + 1))
            continue
        fi
        printf "  [STALE]    %s (size %s bytes — re-downloading)\n" "$NAME" "$SZ"
    fi

    mkdir -p "$(dirname "$FULL")"

    printf "  [DOWNLOAD] %-45s  ~%s\n" "$NAME" "$SIZE_LABEL"
    printf "             %s\n" "$URL"

    TMP="$FULL.partial"
    if curl -L --fail --retry 2 --progress-bar -o "$TMP" "$URL"; then
        if [ -f "$TMP" ] && [ "$(wc -c < "$TMP" | tr -d ' ')" -gt 1024 ]; then
            mv "$TMP" "$FULL"
            MB=$(awk "BEGIN {printf \"%.1f\", $(wc -c < "$FULL" | tr -d ' ') / 1048576}")
            printf "  [OK]       Saved %s MB\n" "$MB"
            DOWNLOADED=$((DOWNLOADED + 1))
        else
            rm -f "$TMP"
            printf "  [FAIL]     downloaded file missing or too small\n"
            printf "             Manual: curl -L -o \"%s\" \"%s\"\n" "$FULL" "$URL"
            FAILURES+=("$NAME")
        fi
    else
        rm -f "$TMP"
        printf "  [FAIL]     curl returned non-zero\n"
        printf "             Manual: curl -L -o \"%s\" \"%s\"\n" "$FULL" "$URL"
        FAILURES+=("$NAME")
    fi
done

echo ""
if [ "${#FAILURES[@]}" -gt 0 ]; then
    echo "[MODELS] Downloaded $DOWNLOADED, skipped $SKIPPED, FAILED ${#FAILURES[@]}"
    for f in "${FAILURES[@]}"; do echo "         FAIL: $f"; done
    echo "         Voice STT/TTS will be unhealthy until the failed models are resolved."
    echo "         Text chat works without them."
    exit 1
elif [ "$DOWNLOADED" -gt 0 ]; then
    echo "[MODELS] Downloaded $DOWNLOADED, skipped $SKIPPED"
else
    echo "[MODELS] All models present (skipped $SKIPPED)"
fi
echo ""
exit 0
