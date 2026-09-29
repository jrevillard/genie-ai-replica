#!/usr/bin/env bash
# Self-contained local runner for the PII redactor smoke test.
#
# Brings up the two containers `test-pii-redactor.sh` asserts against,
# using the UNMODIFIED production collector config, runs the assertions,
# and tears down. One command — no need to have the observability compose
# profile up first.
#
#   ./tests/otel-collector/run-pii-smoke.sh
#
# WHEN TO RUN IT (there is no CI job for this — it is a manual gate):
#   - any edit to configs/otel/otel-collector-config.yaml
#   - any edit to the PII key list or the redaction statements
#   - any change to how log bodies are shaped before they reach the
#     collector (stamp_log_metadata_from_msg, fluentd driver config)
#
# It reproduces a real end-to-end path: curl -> OTLP/HTTP :4318 ->
# collector (transform/pii_redact) -> otlp_http -> VictoriaLogs
# /insert/opentelemetry -> LogSQL query back. Nothing is mocked, and the
# assertions read the row back by its unique marker, so a redactor that
# silently stops redacting fails the test instead of passing on ambient
# data.
#
# Container names and images mirror docker-compose.yaml so the test
# exercises what actually ships:
#   collector  otel/opentelemetry-collector-contrib:0.152.0
#   VL         victoriametrics/victoria-logs:v1.50.0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COLLECTOR_IMAGE="otel/opentelemetry-collector-contrib:0.152.0"
VL_IMAGE="victoriametrics/victoria-logs:v1.50.0"
# Suffix every docker name with the PID. A shared fixed name makes two
# concurrent runs on one machine destructive: the second run's startup
# `docker rm -f` / `network rm` would tear down the FIRST run's
# containers, and its EXIT trap would repeat the damage. With a per-run
# suffix neither run can see the other's resources.
RUN_ID="$$"
NETWORK="genie-ai-pii-smoke-$RUN_ID"
# Deliberately NOT the historical `piired-*` names — a previous manual run
# left stopped containers under those, and reusing a container that is not
# on this network would break DNS resolution to it.
VL_CONTAINER="genie-pii-vl-$RUN_ID"
COLLECTOR_CONTAINER="genie-pii-collector-$RUN_ID"
STATE_DIR="${TMPDIR:-/tmp}/genie-ai-pii-smoke-$RUN_ID"

cleanup() {
  local rc=$?
  docker rm -f "$COLLECTOR_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$VL_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  if [ "$rc" -eq 0 ]; then rm -rf "$STATE_DIR"; else echo "artifacts kept: $STATE_DIR" >&2; fi
  echo "exit=$rc" >&2
  exit "$rc"
}
trap cleanup EXIT
mkdir -p "$STATE_DIR/victoriatraces"
# The collector image runs as uid 10001 and its persistent-queue storage
# must be writable by that uid. Compose guarantees this with the one-shot
# `otel-collector-init` service (`chown -R 10001:10001 /var/lib/otelcol`);
# a bind-mounted host dir is root-owned, so without this the collector dies
# with "permission denied" on the victoriatraces exporter's queue file.
# 0777 rather than chown because a local test run may not be root.
chmod 777 "$STATE_DIR" "$STATE_DIR/victoriatraces"

if ! docker info >/dev/null 2>&1; then
  echo "FAIL: docker is not reachable." >&2
  exit 1
fi

# Names are PID-suffixed, so there is nothing of ours left to clear: any
# container or network matching these names is this run's own.
docker network create "$NETWORK" >/dev/null

# --- VictoriaLogs ------------------------------------------------------------
docker run -d --name "$VL_CONTAINER" --network "$NETWORK" \
  "$VL_IMAGE" -storageDataPath=/vlogs >/dev/null

# --- Collector (production config, read-only) --------------------------------
# The file_storage/victoriatraces directory MUST exist or the collector exits
# at startup ("directory must exist") — compose guarantees this via the
# one-shot otel-collector-init service that mkdir -p's it. Reproduced here.
docker run -d --name "$COLLECTOR_CONTAINER" --network "$NETWORK" \
  -e VICTORIALOGS_URL="http://${VL_CONTAINER}:9428" \
  -e VICTORIALOGS_URL_HOST="${VL_CONTAINER}" \
  -e VICTORIALOGS_TENANT_ID_ACCOUNT_ID=0 \
  -e VICTORIALOGS_TENANT_ID_PROJECT_ID=0 \
  -v "${ROOT}/configs/otel/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  -v "${STATE_DIR}/victoriatraces:/var/lib/otelcol/file_storage/victoriatraces" \
  "$COLLECTOR_IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null

# --- Fast config gate --------------------------------------------------------
# Catches an OTTL parse error (the failure mode that silently took the whole
# collector down) in seconds, before the slower behavioural assertions.
# The collector image is distroless — no shell, no `docker exec` probe — so
# liveness is read from the daemon, not from inside the container.
sleep 6
if [ "$(docker inspect -f '{{.State.Running}}' "$COLLECTOR_CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "FAIL: collector exited during startup — config rejected." >&2
  docker logs --tail 40 "$COLLECTOR_CONTAINER" 2>&1 || true
  exit 1
fi
if docker logs "$COLLECTOR_CONTAINER" 2>&1 | grep -q "invalid syntax"; then
  echo "FAIL: OTTL statement has invalid syntax." >&2
  docker logs --tail 40 "$COLLECTOR_CONTAINER" 2>&1 || true
  exit 1
fi
echo "INFO: collector started, config parsed." >&2

# --- Assertions --------------------------------------------------------------
PII_SMOKE_CI=1 \
  VL_CONTAINER_NAME="$VL_CONTAINER" \
  COLLECTOR_CONTAINER_NAME="$COLLECTOR_CONTAINER" \
  "${ROOT}/tests/otel-collector/test-pii-redactor.sh"
