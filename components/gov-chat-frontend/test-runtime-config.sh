#!/bin/sh
# Runtime-config contract check (A4) — re-runnable, no framework, no docker.
# Idiom follows configs/keycloak/test-realm-contract.sh (A2).
# Executes docker-entrypoint.sh directly (pure sh; CONFIG_DIST_DIR redirects
# the config.js target to a scratch dir) and asserts:
#   (a) the emitted config.js carries the fed values: apiUrl, proxyHost,
#       keycloak.{url, realm, client_id}
#   (b) realm defaults to the product realm 'agrivisory' when unset
#   (c) malformed VUE_APP_API_URL is rejected: non-URL garbage, and the
#       protocol-relative '//evil/api' bypass
#   (d) quote/backslash values are rejected (config.js string injection)
# Exit 0 = all green.
set -u

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
entrypoint="$here/docker-entrypoint.sh"

fails=0
fail() { echo "FAIL: $1" >&2; fails=$((fails + 1)); }
pass() { echo "ok: $1"; }

# run <env assignments...> — scratch CONFIG_DIST_DIR + the given env, exit rc passed through
run() {
  scratch=$(mktemp -d)
  mkdir -p "$scratch/dist"
  env CONFIG_DIST_DIR="$scratch/dist" "$@" sh "$entrypoint" true
  rc=$?
  rm -rf "$scratch"
  return $rc
}

# --- (a) fed values land in config.js -----------------------------------------
scratch=$(mktemp -d)
mkdir -p "$scratch/dist"
env CONFIG_DIST_DIR="$scratch/dist" \
  VUE_APP_API_URL=/contract-api \
  VUE_PROXY_HOST=kong \
  VUE_APP_CSP_CONNECT_SRC="'self' http://localhost:3000" \
  VUE_APP_AVAILABLE_LOCALES=en,fr \
  VUE_APP_KEYCLOAK_URL=https://kc.example.com/auth \
  VUE_APP_KEYCLOAK_REALM=agrivisory \
  VUE_APP_KEYCLOAK_CLIENT_ID=itu-agrivisory-client \
  sh "$entrypoint" true >/dev/null 2>&1 && cfg="$scratch/dist/config.js" || {
  fail "entrypoint exited non-zero with a valid scratch env"
  cfg=/dev/null
}

check() { # check <pattern> <description>
  if grep -qF "$1" "$cfg"; then pass "$2"; else fail "$2 (pattern not found in emitted config.js)"; fi
}
check 'apiUrl: "/contract-api"'           "apiUrl fed value"
check 'proxyHost: "kong"'                 "proxyHost fed value"
check 'url: "https://kc.example.com/auth"' "keycloak.url fed value"
check 'realm: "agrivisory"'               "keycloak.realm fed value"
check 'client_id: "itu-agrivisory-client"' "keycloak.client_id fed value"
rm -rf "$scratch"

# --- (b) realm default is the product realm -----------------------------------
scratch=$(mktemp -d)
mkdir -p "$scratch/dist"
env CONFIG_DIST_DIR="$scratch/dist" sh "$entrypoint" true >/dev/null 2>&1
if grep -qF 'realm: "agrivisory"' "$scratch/dist/config.js"; then
  pass "realm defaults to agrivisory when VUE_APP_KEYCLOAK_REALM unset"
else
  fail "realm default is not agrivisory"
fi
rm -rf "$scratch"

# --- (c)/(d) rejects ------------------------------------------------------------
reject() { # reject <description> <env assignments...>
  desc=$1
  shift
  if run "$@" >/dev/null 2>&1; then
    fail "$desc accepted"
  else
    pass "$desc exits 1"
  fi
}

reject "garbage VUE_APP_API_URL"            VUE_APP_API_URL=garbage-no-scheme
reject "protocol-relative VUE_APP_API_URL"  VUE_APP_API_URL=//evil/api
reject "quote in VUE_APP_KEYCLOAK_REALM"    VUE_APP_API_URL=/api VUE_APP_KEYCLOAK_REALM='x"; injected = "'
reject "backslash in VUE_APP_KEYCLOAK_URL"  VUE_APP_API_URL=/api VUE_APP_KEYCLOAK_URL='https://x\y'

if [ "$fails" -eq 0 ]; then
  echo "runtime-config contract: all green"
  exit 0
fi
echo "runtime-config contract: $fails failure(s)" >&2
exit 1
