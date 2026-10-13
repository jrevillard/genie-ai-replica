#!/usr/bin/env bash
# Smoke test for the OTel Collector transform/pii_redact processor.
# Strategy: send a known-PII JSON envelope through the PRODUCTION
# collector's OTLP HTTP receiver. The collector runs the unmodified
# production pipeline (pii_redact → set_trace_id_from_body →
# stamp_service_name_from_container → stamp_log_metadata_from_msg →
# normalize_log_body → batch → otlp_http → VL). Read back the VL row
# and assert redaction.
#
# The record travels through the SAME transforms as production — no
# inlined config, no drift between the test and the prod pipeline
# (previously the smoke inlined copies of the transform statements into
# a collector-test.yaml that could silently diverge from production).
#
# Container discovery:
#   - Explicit (PII_SMOKE_CI=1): use VL_CONTAINER_NAME / COLLECTOR_CONTAINER_NAME.
#     This is how `run-pii-smoke.sh` invokes it, after starting its own
#     throwaway pair of containers.
#   - Local mode (default): discover the compose-managed stack via
#     `docker compose ... ps`.
#
# There is NO CI job for this test — it is a MANUAL gate. Run it via
#   ./tests/otel-collector/run-pii-smoke.sh
# whenever you touch configs/otel/otel-collector-config.yaml, the PII key
# list, or the shape of log bodies arriving at the collector. Nothing else
# in the pipeline exercises this path, which is how the redaction
# statements once went six rounds of review with assertions that could not
# fail.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="${TMPDIR:-/tmp}/pii-redact-$$"
mkdir -p "$TMP"
# On failure, keep TMP for inspection; on success, clean up.
cleanup() {
  local rc=$?
  if [ "$rc" -eq 0 ]; then rm -rf "$TMP"; fi
  echo "TMP=$TMP (exit=$rc)" >&2
  exit "$rc"
}
trap cleanup EXIT

# --- Discover VL + collector containers ---
if [ "${PII_SMOKE_CI:-0}" = "1" ]; then
  # Containers started by the caller (`run-pii-smoke.sh`), which passes the
  # names explicitly so this script never depends on hardcoded ones.
  VL_CONTAINER="${VL_CONTAINER_NAME:-piired-vl}"
  COLLECTOR_CONTAINER="${COLLECTOR_CONTAINER_NAME:-piired-collector}"
else
  # Local dev: discover the live compose project name. Hardcoded names
  # (`<project>_genieai_network`, `<project>-victorialogs-1`) would
  # break with `--project-name` overrides — discover at runtime.
  COMPOSE_PROJECT=$(docker compose -f "${ROOT}/docker-compose.yaml" ps --format json 2>/dev/null \
    | python3 -c "
import sys, json
try:
    services = json.load(sys.stdin)
    for s in services:
        n = s.get('Name', '')
        if n.endswith('-victorialogs-1'):
            print(n[: -len('-victorialogs-1')])
            sys.exit(0)
except Exception:
    pass
" 2>/dev/null)
  if [ -z "${COMPOSE_PROJECT}" ]; then
    COMPOSE_PROJECT="$(basename "${ROOT}")"
  fi
  VL_CONTAINER="${COMPOSE_PROJECT}-victorialogs-1"
  COLLECTOR_CONTAINER="${COMPOSE_PROJECT}-otel-collector-1"
fi

if ! docker inspect "${COLLECTOR_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: collector container '${COLLECTOR_CONTAINER}' is not running."
  echo "  CI:  ensure .gitlab-ci.yml brought it up (PII_SMOKE_CI=1)."
  echo "  Local: start the observability stack —"
  echo "    docker compose --profile observability up -d otel-collector victorialogs"
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | head -20
  exit 1
fi
if ! docker inspect "${VL_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: VL container '${VL_CONTAINER}' is not running."
  exit 1
fi
echo "INFO: VL_CONTAINER=${VL_CONTAINER}  COLLECTOR_CONTAINER=${COLLECTOR_CONTAINER}" >&2

# --- Wait for the collector to be ready ---
# Production collector's health_check extension listens on 13133. Probe
# from a sidecar sharing the collector's netns so localhost:13133
# reaches the collector (the collector image is distroless — no shell,
# no wget/curl — so `docker exec` is not an option).
for i in $(seq 1 30); do
  if docker run --rm --network "container:${COLLECTOR_CONTAINER}" \
       --entrypoint "" curlimages/curl:8.10.1 \
       curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13133/ 2>/dev/null \
       | grep -q '^200$'; then
    break
  fi
  sleep 1
done
# Final readiness probe — fail loudly if the collector never came up.
READY=$(docker run --rm --network "container:${COLLECTOR_CONTAINER}" \
          --entrypoint "" curlimages/curl:8.10.1 \
          curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13133/ 2>/dev/null || echo "000")
if [ "${READY}" != "200" ]; then
  echo "FAIL: collector did not become ready within 30s (last status=${READY})"
  docker logs --tail 50 "${COLLECTOR_CONTAINER}" 2>&1 || true
  exit 1
fi

# --- Compose the OTLP/HTTP log request body ---
# Body is a Winston-style JSON envelope (string) so the prod
# stamp_log_metadata_from_msg has something to ParseJSON — the JSON
# structure is preserved through the pipeline and lands in VL's `_msg`
# stream field (NOT extracted into a typed field).
#
# PII keys (session_id, email, mail) sit inside the JSON so the
# `transform/pii_redact` processor (which runs FIRST) redacts them via
# the production `"key":"value"` regex before stamp_log_metadata_from_msg
# overwrites the body with `.message` (which doesn't exist in this
# envelope, so the IsString(ParseJSON(body)["message"]) guard filters
# it out and the redacted JSON survives into VL).
#
# trace_id is 32-char hex — VL indexes it as a dedicated stream field;
# non-hex values are dropped from the index.
TIME_NS="$(date +%s)000000000"
TRACE_ID="deadbeefcafebabe1234567890abcdef"
# Alphanumeric only — VL tokenises on non-alphanumeric boundaries, so a
# hyphenated marker would not survive as one searchable token.
TEST_ID="piired$(date +%s)$$"
# Distinct shapes, each covered by a different collector statement:
#   key-based  → session_id / email / mail / password ("k":"v")
#   bearer     → "authorization" holds a bare Bearer token
#   apikey     → sk- prefixed key
#   jwt        → three dot-separated base64url segments
# The value shapes sit in NON-sensitive keys on purpose: the key-based
# regex must not be what redacts them, or the shape statements go untested.
BEARER_TOKEN="abcdefghij0123456789ABCD"
APIKEY="sk-abcdefghijklmnop0123456789"
JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r"

# OTLP/HTTP JSON protobuf envelope. body.stringValue carries the JSON
# envelope; the collector normalises it to a string in the log pipeline.
PAYLOAD=$(cat <<JSON
{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"pii-smoke"}}]},"scopeLogs":[{"scope":{"name":"pii-smoke","version":"1"},"logRecords":[{"timeUnixNano":"${TIME_NS}","severityNumber":9,"severityText":"INFO","body":{"stringValue":"{\"smoke_id\":\"${TEST_ID}\",\"level\":\"info\",\"session_id\":\"abc-123\",\"email\":\"u@x.com\",\"mail\":\"v@y.z\",\"password\":\"hunter2\",\"auth_header\":\"Bearer ${BEARER_TOKEN}\",\"provider_key\":\"${APIKEY}\",\"id_token\":\"${JWT}\",\"trace_id\":\"${TRACE_ID}\"}"},"traceId":"${TRACE_ID}","attributes":[{"key":"smoke.test_id","value":{"stringValue":"${TEST_ID}"}}]}]}]}]}
JSON
)
echo "${PAYLOAD}" > "$TMP/payload.json"

# --- Send the record through the prod collector ---
# Sidecar shares the collector's netns (--network container:<name>) so
# localhost:4318 IS the collector's OTLP HTTP receiver. The collector
# then runs its production pipeline → exports to VL via otlp_http.
#
# The payload is mounted as a file (not piped via stdin) because piping
# JSON via stdin + curl --data-binary @- races with the parent shell's
# pipe-close and surfaces as curl exit 23 ("client returned ERROR on
# write of N bytes"). The collector still receives the request, but
# curl aborts before emitting the HTTP status code. A file mount makes
# the request body fully owned by curl and the exit code reliable.
echo "${PAYLOAD}" > "$TMP/payload.json"
HTTP_CODE=$(docker run --rm \
  --network "container:${COLLECTOR_CONTAINER}" \
  -v "$TMP/payload.json:/tmp/payload.json:ro" \
  --entrypoint "" \
  curlimages/curl:8.10.1 \
  curl -sS -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  --data-binary @/tmp/payload.json \
  -o /dev/null \
  http://127.0.0.1:4318/v1/logs) || {
  echo "FAIL: OTLP HTTP POST to collector failed (curl exit)"
  docker logs --tail 50 "${COLLECTOR_CONTAINER}" 2>&1 || true
  exit 1
}
# OTLP/HTTP success returns 200. Any other code is a config error or a
# malformed payload — fail loudly so a regex regression in production
# surfaces here.
if [ "${HTTP_CODE}" != "200" ]; then
  echo "FAIL: OTLP HTTP POST returned ${HTTP_CODE} (expected 200)"
  docker logs --tail 50 "${COLLECTOR_CONTAINER}" 2>&1 || true
  exit 1
fi

# Wait for the batch processor (default 5s timeout) + export + VL
# indexing. 8s is a conservative margin on top of the batch timeout.
sleep 8

# --- Read back VL and assert redaction ---
# Query by the run-unique `smoke_id` marker, NOT by `_msg:REDACTED`.
# A `REDACTED` filter excludes exactly the rows this test is meant to
# catch: an unredacted record simply never enters the result set, so the
# "PII must not appear" assertions below could not fail. Keying on the
# marker fetches the row whatever state the redactor left it in, which
# is the only way the negative assertions mean anything.
docker exec "${VL_CONTAINER}" \
  wget -qO- "http://127.0.0.1:9428/select/logsql/query?query=_msg:${TEST_ID}&limit=5" \
  > "$TMP/vl.json"

if ! grep -q '"_msg"' "$TMP/vl.json"; then
  echo "FAIL: no VL row found for smoke_id=${TEST_ID} (collector may not have exported)"
  echo "--- collector.log (tail) ---"
  docker logs --tail 50 "${COLLECTOR_CONTAINER}" 2>&1 || true
  echo "--- vl.json ---"
  cat "$TMP/vl.json"
  exit 1
fi

# Original PII values must NOT appear in VL. Each of these is a distinct
# collector statement, so a single broken regex names its own failure.
assert_redacted() {
  local label="$1" needle="$2"
  if grep -qF -- "$needle" "$TMP/vl.json"; then
    echo "FAIL: ${label} still contains original PII: ${needle}"
    cat "$TMP/vl.json"
    exit 1
  fi
}

assert_redacted "session_id" '"session_id":"abc-123"'
assert_redacted "email"      '"email":"u@x.com"'
# mail is an alias of email per configs/otel/pii-key-list.md
assert_redacted "mail alias" '"mail":"v@y.z"'
assert_redacted "password"   '"password":"hunter2"'
assert_redacted "bearer"     "${BEARER_TOKEN}"
assert_redacted "api key"    "${APIKEY}"
assert_redacted "jwt"        "${JWT}"

# Absence alone is not enough: swapping the bearer regex for the JWT
# regex would still redact every value and pass. Each shape must produce
# ITS OWN placeholder, which is what proves the right statement ran.
assert_redacted_to() {
  local label="$1" needle="$2" placeholder="$3"
  if ! grep -qF -- "$placeholder" "$TMP/vl.json"; then
    echo "FAIL: ${label} not replaced by its own placeholder '${placeholder}'"
    cat "$TMP/vl.json"
    exit 1
  fi
}

assert_redacted_to "bearer"  "${BEARER_TOKEN}"  "[REDACTED_BEARER]"
assert_redacted_to "api key" "${APIKEY}"        "[REDACTED_APIKEY]"
assert_redacted_to "jwt"     "${JWT}"           "[REDACTED_JWT]"

# The [REDACTED] placeholder MUST appear (proves redaction ran)
if ! grep -q '\[REDACTED\]' "$TMP/vl.json"; then
  echo "FAIL: no [REDACTED] placeholder in VL row"
  cat "$TMP/vl.json"
  exit 1
fi

# The non-PII marker must survive — guards against a redactor so broad it
# blanks the whole body (which would make every assertion above pass).
if ! grep -qF -- "${TEST_ID}" "$TMP/vl.json"; then
  echo "FAIL: smoke_id marker missing from VL row (redactor over-matched)"
  cat "$TMP/vl.json"
  exit 1
fi

echo "PASS: PII redactor transform works (smoke_id=${TEST_ID})"