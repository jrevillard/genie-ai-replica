#!/usr/bin/env bash
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# Downloads Piper TTS voice files into ./data/piper-voices/.
#
# Default catalog: 3 languages × 2 genders (6 voices total).
# Usage:
#   ./scripts/download-piper-voices.sh                     # all 6 defaults
#   ./scripts/download-piper-voices.sh en_US-ryan-high     # specific voices
#
# Override via env vars (must match what `.env` configures):
#   TTS_PIPER_VOICE_FEMALE_FR / _MALE_FR
#   TTS_PIPER_VOICE_FEMALE_EN / _MALE_EN
#   TTS_PIPER_VOICE_FEMALE_ES / _MALE_ES
set -euo pipefail

VOICES_DIR="${VOICES_DIR:-$(pwd)/data/piper-voices}"
BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

mkdir -p "${VOICES_DIR}"

# Default catalog — male + female × 3 languages.
DEFAULT_VOICES=(
  "${TTS_PIPER_VOICE_FEMALE_EN:-en_US-lessac-high}"
  "${TTS_PIPER_VOICE_MALE_EN:-en_US-ryan-high}"
  "${TTS_PIPER_VOICE_FEMALE_FR:-fr_FR-siwis-medium}"
  "${TTS_PIPER_VOICE_MALE_FR:-fr_FR-tom-medium}"
  "${TTS_PIPER_VOICE_FEMALE_ES:-es_ES-sharvard-medium}"
  "${TTS_PIPER_VOICE_MALE_ES:-es_MX-claude-high}"
  # Swahili — only one voice exists in the Piper catalog (used for both genders).
  "${TTS_PIPER_VOICE_FEMALE_SW:-sw_CD-lanfrica-medium}"
)

# CLI override — if any args, use them instead of the default catalog.
if [[ "$#" -gt 0 ]]; then
  VOICES=("$@")
else
  VOICES=("${DEFAULT_VOICES[@]}")
fi

# Maps voice name to its HF subdirectory; format: <lang>/<lang_full>/<speaker>/<quality>
voice_path() {
  local name="$1"
  case "${name}" in
    # English
    en_US-amy-low)            echo "en/en_US/amy/low" ;;
    en_US-amy-medium)         echo "en/en_US/amy/medium" ;;
    en_US-lessac-medium)      echo "en/en_US/lessac/medium" ;;
    en_US-lessac-high)        echo "en/en_US/lessac/high" ;;
    en_US-libritts_r-medium)  echo "en/en_US/libritts_r/medium" ;;
    en_US-ryan-low)           echo "en/en_US/ryan/low" ;;
    en_US-ryan-medium)        echo "en/en_US/ryan/medium" ;;
    en_US-ryan-high)          echo "en/en_US/ryan/high" ;;
    # French
    fr_FR-siwis-low)          echo "fr/fr_FR/siwis/low" ;;
    fr_FR-siwis-medium)       echo "fr/fr_FR/siwis/medium" ;;
    fr_FR-tom-medium)         echo "fr/fr_FR/tom/medium" ;;
    fr_FR-upmc-medium)        echo "fr/fr_FR/upmc/medium" ;;
    # Spanish
    es_MX-claude-high)        echo "es/es_MX/claude/high" ;;
    es_MX-ald-medium)         echo "es/es_MX/ald/medium" ;;
    es_ES-davefx-medium)      echo "es/es_ES/davefx/medium" ;;
    es_ES-sharvard-medium)    echo "es/es_ES/sharvard/medium" ;;
    # Swahili (Congo)
    sw_CD-lanfrica-medium)    echo "sw/sw_CD/lanfrica/medium" ;;
    *)
      echo ""
      ;;
  esac
}

for voice in "${VOICES[@]}"; do
  subpath=$(voice_path "${voice}")
  if [[ -z "${subpath}" ]]; then
    echo "ERROR: unknown voice '${voice}'. Add it to voice_path() in this script." >&2
    exit 1
  fi
  for ext in onnx onnx.json; do
    target="${VOICES_DIR}/${voice}.${ext}"
    if [[ -f "${target}" ]]; then
      echo "[skip] ${target} already exists"
      continue
    fi
    url="${BASE_URL}/${subpath}/${voice}.${ext}"
    echo "[get ] ${url}"
    curl -L --fail --silent --show-error -o "${target}" "${url}"
  done
done

echo "Done. Voices installed in ${VOICES_DIR}:"
ls -1 "${VOICES_DIR}" | grep -E '\.onnx$' || true
