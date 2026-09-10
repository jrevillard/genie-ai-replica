#!/bin/sh
# Lifecycle smoke runner: mint tokens, copy harness in, run against the
# local build stack (C:\Dev\builds\main).
set -e
ROOT=/c/Dev/builds/main
ROOTW=C:/Dev/builds/main
cd "$ROOT"
node data/okf/smoke-test/mint-tokens.mjs /tmp/smoke-tokens.json >/dev/null 2>&1
WINP=$(cygpath -w /tmp/smoke-tokens.json)
ADMIN=$(node -e "console.log(require(process.argv[1]).admin)" "$WINP")
export MSYS2_ARG_CONV_EXCL='*'
docker cp "$ROOTW/data/okf/smoke-test/run-smoke-lifecycle.js" main-okf-server-1:/app/run-smoke-lifecycle.js
docker exec -e OKF_SMOKE_TOKEN_ADMIN="$ADMIN" main-okf-server-1 node /app/run-smoke-lifecycle.js 2>&1 | grep -E '^(PASS|FAIL|SMOKE|cleanup)'