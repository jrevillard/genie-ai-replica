#!/usr/bin/env bash
# Cross-layer OIDC redirect scheme coherence check.
# Validates consistency across all 4 layers (pure text parsing, no toolchains):
#   1. Dart flavor configs (redirectScheme: '...')
#   2. Gradle build.gradle (appAuthRedirectScheme: "...")
#   3. iOS XCConfig files (APP_AUTH_REDIRECT_SCHEME = ...)
#   4. env template (KC_MOBILE_REDIRECT_SCHEME=...)
#
# Exit 0 if all layers agree per flavor; exit 1 with diff on mismatch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_ROOT/../.." && pwd)"

DART_DIR="$MOBILE_ROOT/lib/config"
GRADLE_FILE="$MOBILE_ROOT/android/app/build.gradle"
IOS_DIR="$MOBILE_ROOT/ios/Flutter"
ENV_FILE="$REPO_ROOT/env"

errors=0

# ── 1. Dart schemes per flavor ─────────────────────────────────────────
declare -A dart_schemes
for f in \
  "$DART_DIR/dev_config.dart" \
  "$DART_DIR/staging_config.dart" \
  "$DART_DIR/e2e_config.dart" \
  "$DART_DIR/flavors/itu.dart"; do
  flavor="$(basename "$f" .dart)"
  # Strip _config suffix (dev_config → dev, staging_config → staging, etc.)
  flavor="${flavor%_config}"
  scheme="$(grep -oP "redirectScheme:\s*'\K[^']+" "$f" || true)"
  if [[ -z "$scheme" ]]; then
    echo "ERROR: no redirectScheme found in Dart file: $f"
    errors=$((errors + 1))
  else
    dart_schemes["$flavor"]="$scheme"
  fi
done

# ── 2. Gradle schemes per flavor ───────────────────────────────────────
declare -A gradle_schemes
for flavor in dev staging e2e itu; do
  scheme="$(awk "/^[[:space:]]*${flavor}[[:space:]]*\\{/,/\\}/" "$GRADLE_FILE" \
    | grep -oP 'appAuthRedirectScheme:\s*"\K[^"]+' || true)"
  if [[ -z "$scheme" ]]; then
    echo "ERROR: no appAuthRedirectScheme in build.gradle for flavor: $flavor"
    errors=$((errors + 1))
  else
    gradle_schemes["$flavor"]="$scheme"
  fi
done

# ── 3. iOS XCConfig schemes per flavor ─────────────────────────────────
# Check all 3 build modes (Debug, Profile, Release) — all must agree.
declare -A ios_schemes
for flavor in dev staging e2e itu; do
  mode_schemes=()
  for mode in Debug Profile Release; do
    xcconfig="$IOS_DIR/${mode}-${flavor}.xcconfig"
    if [[ ! -f "$xcconfig" ]]; then
      echo "ERROR: iOS XCConfig missing: $xcconfig"
      errors=$((errors + 1))
      continue
    fi
    scheme="$(grep -oP 'APP_AUTH_REDIRECT_SCHEME\s*=\s*\K\S+' "$xcconfig" || true)"
    if [[ -z "$scheme" ]]; then
      echo "ERROR: no APP_AUTH_REDIRECT_SCHEME in $xcconfig"
      errors=$((errors + 1))
    else
      mode_schemes+=("$scheme")
    fi
  done
  # All modes for this flavor must agree
  if [[ ${#mode_schemes[@]} -gt 0 ]]; then
    first="${mode_schemes[0]}"
    for s in "${mode_schemes[@]}"; do
      if [[ "$s" != "$first" ]]; then
        echo "ERROR: iOS XCConfig schemes disagree for flavor $flavor: ${mode_schemes[*]}"
        errors=$((errors + 1))
        break
      fi
    done
    ios_schemes["$flavor"]="$first"
  fi
done

# ── 4. env template scheme ─────────────────────────────────────────────
env_scheme="$(grep -oP '^KC_MOBILE_REDIRECT_SCHEME=\K\S+' "$ENV_FILE" || true)"
if [[ -z "$env_scheme" ]]; then
  echo "ERROR: KC_MOBILE_REDIRECT_SCHEME not found in $ENV_FILE"
  errors=$((errors + 1))
fi

# ── 5. Cross-layer comparison ──────────────────────────────────────────
for flavor in dev staging e2e itu; do
  d="${dart_schemes[$flavor]:-MISSING}"
  g="${gradle_schemes[$flavor]:-MISSING}"
  i="${ios_schemes[$flavor]:-MISSING}"

  if [[ "$d" != "$g" ]]; then
    echo "MISMATCH [$flavor]: Dart='$d' vs Gradle='$g'"
    errors=$((errors + 1))
  fi
  if [[ "$d" != "$i" ]]; then
    echo "MISMATCH [$flavor]: Dart='$d' vs iOS='$i'"
    errors=$((errors + 1))
  fi
done

# env template holds the itu (default deployment) scheme
if [[ -n "$env_scheme" && -n "${dart_schemes[itu]:-}" ]]; then
  if [[ "$env_scheme" != "${dart_schemes[itu]}" ]]; then
    echo "MISMATCH: env KC_MOBILE_REDIRECT_SCHEME='$env_scheme' vs Dart itu='${dart_schemes[itu]}'"
    errors=$((errors + 1))
  fi
fi

# ── 6. Report ──────────────────────────────────────────────────────────
if [[ "$errors" -gt 0 ]]; then
  echo ""
  echo "scheme coherence FAILED ($errors error(s))"
  exit 1
fi

echo "scheme coherence OK"
exit 0
