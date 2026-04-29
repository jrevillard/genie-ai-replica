#!/bin/sh
set -e

# ─── Coqui TTS wait (DISABLED — Piper runs inside gateway) ───
# echo "Waiting for Docker DNS (voice-tts)..."
# until getent hosts voice-tts >/dev/null 2>&1; do
#   sleep 1
# done
#
# echo "Waiting for voice-tts HTTP..."
# until curl -fsS http://voice-tts:5002 >/dev/null 2>&1; do
#   sleep 2
# done

echo "Waiting for Docker DNS (voice-stt)..."
until getent hosts voice-stt >/dev/null 2>&1; do
  sleep 1
done

echo "Waiting for voice-stt HTTP..."
until curl -fsS http://voice-stt:8080 >/dev/null 2>&1; do
  sleep 2
done

echo "Starting voice-gateway..."
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8010