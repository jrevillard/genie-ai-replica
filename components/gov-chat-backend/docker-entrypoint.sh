#!/bin/bash
# Wait for ArangoDB to be ready before starting the backend.
# Similar to the Kong/PostgreSQL wait pattern in docker-compose.yaml.
# ArangoDB can take up to 150s to pass healthchecks (start_period + retries).

set -e

ARANGO_HOST="${ARANGO_URL#http://}"  # Strip http://
ARANGO_HOST="${ARANGO_HOST%%:*}"       # Strip port
ARANGO_PORT="${ARANGO_URL##*:}"       # Extract port
ARANGO_USER="${ARANGO_USER:-root}"
ARANGO_PASSWORD="${ARANGO_PASSWORD}"

echo "[entrypoint] Waiting for ArangoDB at ${ARANGO_HOST}:${ARANGO_PORT}..."
for i in $(seq 1 30); do
  if curl -sf "http://${ARANGO_HOST}:${ARANGO_PORT}/_api/version" \
       -u "${ARANGO_USER}:${ARANGO_PASSWORD}" > /dev/null 2>&1; then
    echo "[entrypoint] ArangoDB ready (attempt ${i}/30)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[entrypoint] ERROR: ArangoDB not ready after 30 attempts (60s)"
    exit 1
  fi
  sleep 2
done

echo "[entrypoint] Starting backend..."
exec "$@"
