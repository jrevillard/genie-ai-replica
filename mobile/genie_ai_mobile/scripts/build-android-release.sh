#!/usr/bin/env bash
# Build a signed Android release APK (runs inside android-builder.Dockerfile).
#
# Signing, one of:
#   a) android/key.properties already present (local builds) — used as-is
#   b) env vars (CI) — key.properties is generated and removed afterwards:
#      ANDROID_KEYSTORE     path to the release keystore (.jks)
#      KEYSTORE_PASSWORD    keystore password
#      KEY_ALIAS            key alias inside the keystore
#      KEY_PASSWORD         key password
# Optional env:
#   FLAVOR               build flavor (default: itu)
#   BUILD_NAME           user-facing version, e.g. 1.0.1 (default: pubspec.yaml)
#   BUILD_NUMBER         Android versionCode, must increase every release (default: pubspec.yaml)
#   OUTPUT_DIR           where the APK is copied (default: ./dist)
set -euo pipefail

cd "$(dirname "$0")/.."

FLAVOR="${FLAVOR:-itu}"
OUTPUT_DIR="${OUTPUT_DIR:-dist}"

# build.gradle silently falls back to the debug key without key.properties;
# a debug-signed APK cannot update an installed release, so fail instead.
if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  if [ -f android/key.properties ]; then
    echo "ERROR: android/key.properties exists and ANDROID_KEYSTORE is set — use one or the other" >&2
    exit 1
  fi
  for var in KEYSTORE_PASSWORD KEY_ALIAS KEY_PASSWORD; do
    if [ -z "${!var:-}" ]; then
      echo "ERROR: $var is not set" >&2
      exit 1
    fi
  done
  cp "$ANDROID_KEYSTORE" android/app/release.jks
  trap 'rm -f android/app/release.jks android/key.properties' EXIT
  cat > android/key.properties <<EOF
storeFile=release.jks
storePassword=${KEYSTORE_PASSWORD}
keyAlias=${KEY_ALIAS}
keyPassword=${KEY_PASSWORD}
EOF
  chmod 600 android/key.properties
elif [ -f android/key.properties ]; then
  # storeFile is resolved relative to android/app/ (build.gradle uses file()).
  STORE_FILE=$(grep '^storeFile=' android/key.properties | cut -d= -f2-)
  if [ ! -f "android/app/$STORE_FILE" ] && [ ! -f "$STORE_FILE" ]; then
    echo "ERROR: keystore '$STORE_FILE' from android/key.properties not found" >&2
    exit 1
  fi
else
  echo "ERROR: no android/key.properties and no ANDROID_KEYSTORE — refusing to build an unsigned release" >&2
  exit 1
fi

VERSION_ARGS=()
[ -n "${BUILD_NAME:-}" ] && VERSION_ARGS+=(--build-name="$BUILD_NAME")
[ -n "${BUILD_NUMBER:-}" ] && VERSION_ARGS+=(--build-number="$BUILD_NUMBER")

flutter pub get
# --flavor selects the Android product flavor; FLAVOR selects the Dart
# KeycloakConfig (lib/config/keycloak_config.dart defaults to 'dev' without it).
flutter build apk --release --flavor "$FLAVOR" \
  --dart-define=FLAVOR="$FLAVOR" --no-tree-shake-icons "${VERSION_ARGS[@]}"

mkdir -p "$OUTPUT_DIR"
VERSION=$(grep '^version:' pubspec.yaml | sed 's/version: *//; s/+.*//')
APK="$OUTPUT_DIR/genie-ai-${FLAVOR}-${BUILD_NAME:-$VERSION}.apk"
cp "build/app/outputs/flutter-apk/app-${FLAVOR}-release.apk" "$APK"
echo "Built $APK"
